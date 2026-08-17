# The App That Isn’t an App

I’ve been exploring how to turn **a web app** into something that **feels like a native app** — installable on the **home screen**, **fast**, **offline-friendly**, and serving multiple services from one simple experience.

Creating a mobile Progressive Web App (PWA) that functions like a **native mobile application**, offering key features: 
- Load instantly
- Work offline or on low-quality networks
- Be installed on a device
- Send push notifications
- Operate in full-screen mode

Want to know more: 
- https://adriensieg.substack.com/p/the-app-that-isnt-an-app-your-phone
- https://lnkd.in/p/g9kC5nZP

# Hello

```mcd/
├── apps/
│   └── hello/
│       ├── app/
│       │   ├── static/
│       │   │   ├── icons/
│       │   │   │   ├── icon-180.png
│       │   │   │   ├── icon-192.png
│       │   │   │   └── icon-512.png
│       │   │   ├── notif-store.js
│       │   │   ├── script.js
│       │   │   ├── style.css
│       │   │   └── sw.js
│       │   ├── templates/
│       │   └── main.py
│       ├── requirements.txt
│       ├── k8s/
│       │   ├── deployment.yaml
│       │   └── service.yaml
│       └── Dockerfile
```

#### Tutorial:
- A. Fresh Deployment Tutorial in `mcd` workspace
- B. Push Notifications — Quick Ops Guide
- C. Add a new app to the current workspace

# A. Fresh Deployment Tutorial in `mcd` workspace

### 1. Tear down existing deployment
```bash
kubectl delete pods --all -n mcd
kubectl delete namespace mcd
```

### 2. Recreate namespace and Cloudflare tunnel
```bash
kubectl apply -f infrastructure/namespaces.yaml
kubectl apply -f infrastructure/cloudflare/configmap.yaml
kubectl rollout restart deployment cloudflared -n cloudflare
```

### 3. Create the GHCR pull secret

Replace the PAT with a valid GitHub token.

```bash
$PAT = "ghp_xxx"
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=adriensieg \
  --docker-password=$PAT \
  --docker-email=adriensieg@hotmail.fr \
  -n mcd
```

### 4. Generate and create VAPID keys

Generate a fresh key pair:

```bash
pip install py-vapid cryptography
python -c "from py_vapid import Vapid01; from cryptography.hazmat.primitives import serialization; import base64; v=Vapid01(); v.generate_keys(); b=lambda x: base64.urlsafe_b64encode(x).decode().rstrip('='); pub=v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint); priv=v.private_key.private_numbers().private_value.to_bytes(32,'big'); print('PUBLIC =', b(pub)); print('PRIVATE=', b(priv))"
```
Create the secret from the output:

```bash
kubectl create secret generic vapid-keys -n mcd \
  --from-literal=public=<PUBLIC> \
  --from-literal=private=<PRIVATE>
```
To rotate later: `kubectl delete secret vapid-keys -n mcd`, then recreate.

### 5. Build and push images (linux/arm64)

```bash
docker buildx build --platform linux/arm64 -t ghcr.io/adriensieg/mcd-hello:latest --push spaces/mcd/apps/hello
docker buildx build --platform linux/arm64 -t ghcr.io/adriensieg/mcd-scanning:latest --push spaces/mcd/apps/scanning
docker buildx build --platform linux/arm64 -t ghcr.io/adriensieg/mcd-troubleshoot:latest --push spaces/mcd/apps/troubleshoot
docker buildx build --platform linux/arm64 -t ghcr.io/adriensieg/mcd-push:latest --push spaces/mcd/apps/push
```

### 6. Set package visibility

Confirm each package's visibility/access settings:
https://github.com/users/adriensieg/packages/container/mcd-hello/settings
https://github.com/users/adriensieg/packages/container/mcd-scanning/settings
https://github.com/users/adriensieg/packages/container/mcd-troubleshoot/settings
https://github.com/users/adriensieg/packages/container/mcd-push/settings

### 7. Commit and push changes
```bash
git pull
git add .
git commit -m "feat: add mcd workspace with hello, scanning, troubleshoot and push app"
git push
```

### 8. Register the ArgoCD app

Deploys `argocd/apps/mcd.yaml`, which watches `spaces/mcd` with recurse: `true` — every YAML under it (all app `k8s/` folders plus `ingress/`) is picked up automatically.

```bash
kubectl apply -f argocd/apps/mcd.yaml
kubectl get pods -n mcd -w
```

### 9. (Optional) Apply manifests manually

If not relying on ArgoCD sync:

```bash
kubectl apply -f spaces/mcd/apps/hello/k8s/
kubectl apply -f spaces/mcd/apps/scanning/k8s/
kubectl apply -f spaces/mcd/apps/troubleshoot/k8s/
kubectl apply -f spaces/mcd/ingress/ingress.yaml
```

### 10. Verify

```bash
curl.exe -s -o /dev/null -w "%{http_code}\n" https://mcd.devailab.work/static/notif-store.js
curl.exe -s https://mcd.devailab.work/push/stats
curl.exe -s -X POST https://mcd.devailab.work/push/send -H 'Content-Type: application/json' -d '{"body":"test","badge_count":1}'
```

Security note: The PAT and VAPID keys in your original command are now exposed. Rotate the GitHub PAT and regenerate the VAPID keys before using them anywhere real.

# B. Push Notifications — Quick Ops Guide

Check subscribers (who's signed up)
```powershell
Invoke-RestMethod https://mcd.devailab.work/push/stats
```

Returns subscribers (count), interval_min, scheduler. If subscribers: 0, nobody will receive anything — that's your first thing to check.

The 3 health checks, in order

1. Is a real VAPID key served? (not the placeholder)

powershell
Invoke-RestMethod https://mcd.devailab.work/push/vapid-public-key

Must be a long B... string. If it says REPLACE_WITH_..., the secret is wrong — fix it (below).

2. Are the keys wired into the pod?

powershell
kubectl exec -n mcd deploy/push -- sh -c 'echo pub=${VAPID_PUBLIC_KEY:+set} priv=${VAPID_PRIVATE_KEY:+set}'

Must print pub=set priv=set.

3. Is the scheduler running?

powershell
Invoke-RestMethod https://mcd.devailab.work/push/stats

scheduler: true means auto-push every interval_min. First push waits one full interval.

Send a test notification now
powershell
Invoke-RestMethod -Uri https://mcd.devailab.work/push/send -Method Post -ContentType "application/json" -Body '{"body":"test","badge_count":1}'
sent: 1 → delivered; check your phone.
subscribers: 0 → no one subscribed (subscribe on the phone first).
Subscribe a phone

On the iPhone: open the installed app from the Home Screen (not Safari) → tap Enable reminders → accept. Then re-run /stats — subscribers should go up.

Fix a bad VAPID secret
powershell
# 1. generate a real keypair
python -c "from py_vapid import Vapid01; from cryptography.hazmat.primitives import serialization; import base64; v=Vapid01(); v.generate_keys(); b=lambda x: base64.urlsafe_b64encode(x).decode().rstrip('='); print('PUBLIC =', b(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))); print('PRIVATE=', b(v.private_key.private_numbers().private_value.to_bytes(32,'big')))"

# 2. recreate the secret
kubectl delete secret vapid-keys -n mcd
kubectl create secret generic vapid-keys -n mcd --from-literal=public=<REAL_PUBLIC> --from-literal=private=<REAL_PRIVATE>

# 3. restart push to load it
kubectl rollout restart deployment/push -n mcd
Two things that keep breaking this
emptyDir wipes subscribers on every pod restart. After any restart of the push pod, subscribers resets to 0 and everyone must re-subscribe. Fix permanently with a PVC.
ArgoCD reverts the secret if secret.example.yaml is in the synced path — it overwrites your real keys with the placeholder. Remove that file from the repo so ArgoCD stops managing the secret.
The one-line daily check
powershell
Invoke-RestMethod https://mcd.devailab.work/push/stats