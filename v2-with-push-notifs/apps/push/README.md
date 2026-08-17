# Push Service

Server-driven Web Push for the Incubator PWA. Delivers notifications to the lock screen and sets the app badge **even when the app is closed**. Served at `mcd.devailab.work/push`.

## Components

- **VAPID keys** — identify this server to the browser push service.
- **Subscription storage** — persists each device's push subscription (`/data/subscriptions.txt`).
- **Scheduler** — background thread; pushes every `NOTIFY_INTERVAL_MIN` minutes.
- **Badging** — server sends `badge_count`; the service worker sets the icon badge.

## Flow

```
hub JS          fetch /push/vapid-public-key
                pushManager.subscribe(publicKey)     → browser gets endpoint+keys
                POST /push/subscribe {endpoint,keys} → stored here
scheduler       every N min → encrypt + VAPID-sign → POST to push service
push service    verifies VAPID, delivers to device
hub SW          "push" event → showNotification + setAppBadge(n)
```

Two cryptographic steps (per the Web Push spec):
- **Payload encryption** uses the subscription keys (`p256dh`, `auth`) — privacy.
- **VAPID signing** uses the private key — sender identity.
`pywebpush` handles both.

## Setup

### 1. Generate VAPID keys (once)

```bash
python -c "
from py_vapid import Vapid01
from cryptography.hazmat.primitives import serialization
import base64
v=Vapid01(); v.generate_keys()
b=lambda x: base64.urlsafe_b64encode(x).decode().rstrip('=')
pub=v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
priv=v.private_key.private_numbers().private_value.to_bytes(32,'big')
print('public :', b(pub)); print('private:', b(priv))
"
```

### 2. Store them as a k8s secret (never commit real keys)

```bash
kubectl create secret generic vapid-keys -n mcd \
  --from-literal=public=<PUBLIC> \
  --from-literal=private=<PRIVATE>
```

### 3. Deploy

```bash
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml
# re-apply the shared ingress so /push routes here
```

## API

| Method | Path                    | Purpose                              |
|--------|-------------------------|--------------------------------------|
| GET    | /push/vapid-public-key  | Public key for browser subscription  |
| POST   | /push/subscribe         | Store a subscription                 |
| POST   | /push/unsubscribe       | Remove a subscription (by endpoint)  |
| POST   | /push/send              | Manual broadcast (test hook)         |
| GET    | /push/stats             | Subscriber count + config            |
| GET    | /push/health            | Liveness/readiness                   |

## Config (env)

| Var                 | Default                     | Notes                         |
|---------------------|-----------------------------|-------------------------------|
| VAPID_PUBLIC_KEY    | —                           | from secret                   |
| VAPID_PRIVATE_KEY   | —                           | from secret                   |
| VAPID_SUBJECT       | mailto:admin@devailab.work  | contact for push service      |
| NOTIFY_INTERVAL_MIN | 5                           | scheduler cadence             |
| SCHEDULER_ENABLED   | true                        | set false to disable auto-push|
| SUBS_FILE           | /data/subscriptions.txt     | storage path                  |

## Production notes

- **Storage:** subscriptions are on an `emptyDir` — lost on pod reschedule. Use a **PersistentVolumeClaim** (or a DB) so subscribers survive restarts.
- **Replicas:** keep `replicas: 1`. Multiple replicas each running the scheduler would multi-send; move the scheduler to a `CronJob` or add leader election before scaling.
- **iOS:** push only works after the user installs the PWA to the Home Screen (iOS 16.4+) and grants permission.
