# Server Dashboard

Dashboard privé (accessible uniquement via Tailscale) affichant :
- l'état du serveur : CPU, mémoire, disque, réseau, load average, température, uptime
- l'état de chaque site hébergé : en ligne/hors ligne, temps de réponse, CPU/RAM du
  processus, et (si le site l'expose) le nombre de joueurs/utilisateurs connectés
- un historique (SQLite) consultable sur 1h / 6h / 24h / 7j

Conçu pour accueillir plusieurs sites : ajoute une entrée dans `config/sites.json`
pour chaque nouveau site.

## 1. Copier le projet sur le serveur

Depuis cette machine Windows, envoie le dossier `server-dashboard/` sur ton serveur
Debian (adapte `server@100.93.127.109` à ton user/IP Tailscale) :

```bash
scp -r server-dashboard server@100.93.127.109:/home/server/
```

(ou `git init` + push vers un repo perso, ou `rsync -avz` — au choix)

## 2. Installer les dépendances sur le serveur

```bash
cd /home/server/server-dashboard
npm install --omit=dev
```

Si `better-sqlite3` échoue à s'installer (compilation native) :

```bash
sudo apt update && sudo apt install -y build-essential python3
npm install --omit=dev
```

## 3. Configurer

```bash
cp .env.example .env
tailscale ip -4
```

Édite `.env` et mets ton IP Tailscale réelle (celle retournée par `tailscale ip -4`)
dans `HOST`. C'est ce qui garantit que le dashboard n'est joignable que depuis ton
réseau Tailscale, jamais depuis internet.

Édite aussi `config/sites.json` si besoin (URL publique du site, port local, etc.).

## 4. Exposer le nombre de joueurs (optionnel mais recommandé)

Voir [`deploy/blindtest-stats-endpoint.md`](deploy/blindtest-stats-endpoint.md) pour
ajouter une route `/internal/stats` à blindtest. Sans ça, le dashboard affichera
quand même le statut (en ligne/hors ligne) et le CPU/RAM du processus, juste pas le
nombre de joueurs.

## 5. Tester manuellement

```bash
node src/server.js
```

Puis depuis un appareil connecté à ton Tailscale : `http://<IP_TAILSCALE>:4500`

## 6. Installer comme service systemd (démarrage auto + redémarrage si crash)

```bash
sudo cp deploy/server-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now server-dashboard
sudo systemctl status server-dashboard
```

Si ton user Linux n'est pas `server` ou que le chemin diffère, édite d'abord
`deploy/server-dashboard.service` (`User=`, `WorkingDirectory=`, `EnvironmentFile=`).

## Ajouter un autre site plus tard

Dans `config/sites.json`, ajoute un objet :

```json
{
  "id": "mon-autre-site",
  "name": "Mon Autre Site",
  "url": "https://monsite.example.com",
  "healthCheck": { "target": "http://127.0.0.1:PORT_LOCAL" },
  "process": { "match": "un-bout-du-chemin-ou-nom-du-process" },
  "statsEndpoint": null
}
```

- `healthCheck.target` : URL locale à pinger pour savoir si le site répond.
- `process.match` : sous-chaîne recherchée dans la commande du processus (via `ps`)
  pour calculer son CPU/RAM — regarde `ps aux | grep node` pour trouver un bon match.
- `statsEndpoint` : optionnel, une route JSON interne du site (comme pour blindtest)
  si tu veux remonter un compteur custom (visiteurs, joueurs, etc.).

Redémarre le service dashboard après modification :

```bash
sudo systemctl restart server-dashboard
```

## Sécurité

- Le serveur n'écoute que sur l'IP Tailscale définie dans `.env` — pas d'auth
  nécessaire puisque seuls les appareils de ton tailnet peuvent l'atteindre.
- Ne mets jamais `HOST=0.0.0.0` sans ajouter une authentification, sinon le
  dashboard (et les métriques serveur) seraient exposés si un port forwarding
  existe sur ta box.
