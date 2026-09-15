# Exposer le nombre de joueurs connectés (blindtest)

Le dashboard va chercher le nombre de joueurs sur `http://127.0.0.1:3000/internal/stats`
(voir `config/sites.json`). Il faut ajouter cette route dans `server.ts` de blindtest.

Ceci est un exemple générique — la forme exacte dépend de comment `server.ts` est
structuré (Express custom server + Socket.IO, pattern habituel avec Next.js).
Colle-moi ton `server.ts` si tu veux un patch exact ligne par ligne.

```ts
// À ajouter dans server.ts, après la création du serveur HTTP `httpServer`
// et de l'instance Socket.IO `io`.

httpServer.on('request', (req, res) => {
  // ne rien faire ici si tu utilises déjà un router Express/Next — voir plus bas
});

// Si tu as une app Express (le plus courant avec Next custom server) :
app.get('/internal/stats', (req, res) => {
  const remote = req.socket.remoteAddress || '';
  const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLocal) {
    res.statusCode = 403;
    return res.end();
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    connectedPlayers: io.engine.clientsCount,
    uptimeSeconds: Math.round(process.uptime()),
  }));
});
```

Points importants :
- La route vérifie que la requête vient de `127.0.0.1` (donc uniquement depuis le
  serveur lui-même, jamais exposée publiquement via le tunnel Cloudflare).
- `io.engine.clientsCount` donne le nombre de sockets actuellement connectées.
  Si tu veux compter les "joueurs" au sens du jeu (ex: uniquement ceux dans une
  partie active) plutôt que toutes les connexions websocket, remplace cette ligne
  par ta propre logique (ex: taille d'une Map de joueurs que tu maintiens déjà).
- Redémarre le service blindtest après avoir ajouté la route.
