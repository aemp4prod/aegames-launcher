# Intégration des succès Hype avec Æ Games Launcher

Ce document est le cahier des charges destiné à Claude pour intégrer les succès dans le dépôt de **Hype**. Le schéma de base correspondant se trouve dans `supabase/migrations/202610190003_hype_achievements.sql` du dépôt du launcher.

## Objectif

Hype doit signaler au backend Supabase une progression de succès pendant une session lancée par Æ Games Launcher. Le jeu ne connaît jamais le mot de passe Supabase, la clé `service_role`, l’UUID du joueur ni son identité Discord. Il reçoit uniquement un ticket temporaire et la configuration publique nécessaire pour appeler une RPC.

Le backend prend en charge :

- l’association entre la session de jeu et le compte Æ Games connecté ;
- l’idempotence des événements ;
- la progression monotone ;
- le déverrouillage atomique ;
- l’historique d’audit ;
- la rareté calculée sur les joueurs ayant déjà lancé Hype ;
- la diffusion Realtime au launcher.

## Limite de sécurité à comprendre

Hype est exécuté sur la machine du joueur. Un joueur déterminé peut inspecter ou modifier le processus local et fabriquer des événements tant que son ticket est valide. Le ticket empêche d’écrire pour un autre compte et la base limite les doublons, les opérations et la fréquence, mais il ne rend pas un jeu local inviolable.

Pour un succès compétitif ou récompensé par un bien ayant de la valeur, la condition doit être confirmée par un serveur Hype faisant autorité. Dans ce cas, le serveur appelle une future route dédiée avec un secret serveur ; ne jamais embarquer ce secret dans le jeu.

## Contrat de lancement fourni par le launcher

Le launcher sera chargé de créer une session avec la RPC authentifiée `create_hype_achievement_session`, puis de lancer `Hype.exe` avec ces variables d’environnement :

```text
AE_GAMES_GAME_ID=hype
AE_GAMES_SUPABASE_URL=https://<project-ref>.supabase.co
AE_GAMES_SUPABASE_KEY=<clé publique publishable/anon>
AE_GAMES_ACHIEVEMENT_TOKEN=<ticket aléatoire de 64 caractères hexadécimaux>
AE_GAMES_ACHIEVEMENT_EXPIRES_AT=<date ISO-8601 UTC>
```

Ne pas écrire ces valeurs dans un log, un fichier de sauvegarde, un rapport de crash ou les préférences du jeu. Elles restent seulement en mémoire. Le ticket expire après six heures par défaut et au plus tard après huit heures. Une relance de Hype révoque le ticket précédent.

Si `AE_GAMES_ACHIEVEMENT_TOKEN` est absent, Hype doit continuer à fonctionner normalement. Le service de succès passe en mode indisponible et ne doit jamais empêcher le démarrage, la sauvegarde ou la fermeture du jeu.

## Endpoint HTTP

Chaque événement appelle :

```text
POST {AE_GAMES_SUPABASE_URL}/rest/v1/rpc/record_hype_achievement_event
```

En-têtes :

```http
apikey: {AE_GAMES_SUPABASE_KEY}
Content-Type: application/json
```

Si la configuration utilise encore une ancienne clé `anon` au format JWT, ajouter aussi :

```http
Authorization: Bearer {AE_GAMES_SUPABASE_KEY}
```

Corps JSON :

```json
{
  "p_session_token": "<ticket>",
  "p_event_id": "018f83d6-1d20-7a6c-b52a-84f994c09d7f",
  "p_achievement_key": "gaining-traction",
  "p_operation": "set",
  "p_value": 620,
  "p_client_occurred_at": "2026-10-19T18:42:31.221Z",
  "p_metadata": {
    "gameVersion": "0.26.0",
    "saveId": "main"
  }
}
```

Réponse réussie : tableau JSON contenant une ligne.

```json
[
  {
    "achievement_key": "gaining-traction",
    "title": "Ça commence à prendre",
    "progress": 620,
    "goal": 1000,
    "unlocked_at": null,
    "newly_unlocked": false,
    "idempotent": false
  }
]
```

`idempotent: true` indique que le même `event_id` avait déjà été traité. Ce n’est pas une erreur et l’événement peut être retiré de la file locale.

Un `event_id` ne peut être rejoué qu’avec exactement la même clé de succès, la même opération et la même valeur. Sa réutilisation avec un contenu différent est rejetée comme une erreur de contrat.

## Opérations autorisées

### `unlock`

Déverrouille immédiatement un succès. `p_value` doit être `null`.

```json
{
  "p_achievement_key": "first-crush",
  "p_operation": "unlock",
  "p_value": null
}
```

### `set`

Envoie une valeur absolue. La base conserve le maximum entre l’ancienne et la nouvelle valeur : la progression ne peut donc jamais redescendre. À préférer lorsque Hype connaît déjà un total fiable, par exemple le nombre actuel d’abonnés.

```json
{
  "p_achievement_key": "gaining-traction",
  "p_operation": "set",
  "p_value": 620
}
```

### `increment`

Ajoute une quantité à la progression. À utiliser uniquement pour un événement qui ne peut pas être recalculé depuis la sauvegarde. Chaque tentative doit garder le même `event_id` jusqu’à sa confirmation afin de ne jamais compter deux fois.

```json
{
  "p_achievement_key": "example-counter",
  "p_operation": "increment",
  "p_value": 1
}
```

## Catalogue initial

Le SQL crée trois succès qui correspondent à la maquette actuelle du launcher :

| Clé stable | Type | Objectif | Déclencheur attendu |
|---|---:|---:|---|
| `first-crush` | binaire | 1 | La première vraie connexion est confirmée par les règles métier de Hype. |
| `gaining-traction` | maximum | 1 000 | Envoyer le nombre total d’abonnés après chaque variation ou chargement de sauvegarde. |
| `worldwide-trend` | binaire, secret | 1 | Une publication du joueur atteint le statut de tendance mondiale. |

Les clés sont une API permanente. Ne jamais les traduire, les renommer selon l’UI, ni les réutiliser pour un autre succès. Le titre et la description peuvent évoluer dans la base sans mise à jour du jeu.

Pour ajouter un succès, créer d’abord sa définition dans `achievement_definitions`, puis livrer le code Hype qui émet sa clé. Une définition peut être désactivée avec `is_active = false` sans supprimer la progression des joueurs.

Exemple SQL d’ajout :

```sql
insert into public.achievement_definitions (
  game_key, achievement_key, title, description, icon_key,
  progress_kind, goal, max_increment, points, is_hidden, sort_order
) values (
  'hype', 'social-butterfly', 'Papillon social',
  'Créer 50 connexions', 'users',
  'high_watermark', 50, null, 20, false, 40
);
```

## Travail demandé à Claude dans le dépôt Hype

### 1. Repérer l’architecture réelle

Avant de coder, identifier :

- le langage et le moteur utilisés ;
- le point d’entrée du jeu ;
- le service HTTP existant, le cas échéant ;
- le système de sauvegarde ;
- les endroits exacts où une connexion, le total d’abonnés et une tendance mondiale deviennent officiellement validés.

Réutiliser les abstractions HTTP, de journalisation et de cycle de vie déjà présentes. Ne pas ajouter un second client réseau si le projet en possède un.

### 2. Créer un service unique `AchievementService`

Le service doit :

- lire les cinq variables `AE_GAMES_*` au démarrage ;
- valider que `GAME_ID` vaut exactement `hype`, que l’URL est en HTTPS et que le ticket contient 64 caractères hexadécimaux ;
- rester désactivé silencieusement si la configuration est absente ;
- exposer trois méthodes métier asynchrones :

```text
unlock(achievementKey, metadata?)
setProgress(achievementKey, absoluteValue, metadata?)
incrementProgress(achievementKey, delta, metadata?)
```

- générer un identifiant UUID/ULID unique une seule fois par événement ;
- mettre les événements dans une file avant leur envoi ;
- retirer un événement uniquement après une réponse HTTP 2xx valide ;
- conserver le même identifiant pendant toutes les nouvelles tentatives ;
- limiter les métadonnées à des informations techniques non sensibles et à moins de 4 Ko ;
- ne jamais afficher le ticket ou la clé publique dans les logs.

Le gameplay ne doit pas attendre le réseau. Les méthodes ajoutent à la file et rendent immédiatement la main.

### 3. Politique de nouvelle tentative

- `2xx` : succès, retirer l’événement de la file.
- `400` ou `404` : erreur de contrat ou clé de succès inconnue ; journaliser une erreur sans secret, retirer l’événement pour éviter une boucle.
- `401` ou `403` : ticket expiré/révoqué ; désactiver le service pour la session courante et vider la file en mémoire.
- `429` ou erreur `P0001` de limite : conserver l’événement et réessayer après au moins 60 secondes.
- erreur réseau ou `5xx` : backoff exponentiel avec jitter, par exemple 2 s, 5 s, 15 s, 30 s, puis 60 s maximum.

Une file uniquement en mémoire est acceptable pour la V1. Ne pas persister le ticket. Si une file durable est ajoutée plus tard, persister uniquement l’événement sans ticket et lui attribuer un nouveau ticket au prochain lancement.

### 4. Brancher les trois succès

- Quand la première vraie connexion est validée, appeler `unlock("first-crush")`.
- Au chargement d’une sauvegarde et après chaque variation du compteur d’abonnés, appeler `setProgress("gaining-traction", totalFollowers)`.
- Quand le moteur de tendances confirme une tendance mondiale créée par le joueur, appeler `unlock("worldwide-trend")`.

Les appels peuvent être répétés : `set` est monotone et les succès déjà déverrouillés restent déverrouillés. Malgré cela, éviter de produire un événement à chaque frame. Pour le compteur d’abonnés, n’émettre que si la valeur a changé depuis le dernier événement mis en file.

### 5. Cycle de vie

- Démarrer le worker réseau après l’initialisation du jeu.
- Lors d’une perte de connexion, garder la file en mémoire et continuer la partie.
- À la fermeture normale, accorder au worker un court délai de vidage, maximum deux secondes, sans bloquer plus longtemps la fermeture.
- Ne jamais faire échouer une sauvegarde à cause d’un succès.

### 6. Tests obligatoires

Ajouter des tests couvrant au minimum :

1. service désactivé quand les variables sont absentes ;
2. validation et masquage des secrets ;
3. sérialisation exacte des trois opérations ;
4. réutilisation du même `event_id` après un échec réseau ;
5. retrait après réponse idempotente ;
6. backoff sur `429`/`5xx` ;
7. arrêt des envois sur `401`/`403` ;
8. déduplication locale de deux `setProgress` identiques en attente ;
9. aucun blocage du gameplay lorsque Supabase est indisponible.

Prévoir aussi un faux transport HTTP injecté dans le service pour tester sans contacter Supabase.

## Test manuel de bout en bout

### Préparation côté Supabase

1. Ouvrir le SQL Editor du projet Supabase.
2. Exécuter intégralement `202610190003_hype_achievements.sql`.
3. Vérifier que les trois lignes Hype existent :

```sql
select game_key, achievement_key, progress_kind, goal, is_hidden
from public.achievement_definitions
where game_key = 'hype'
order by sort_order;
```

4. Vérifier que les fonctions sont visibles dans le schéma `public`. Si l’API REST avait déjà mis son cache en mémoire, attendre quelques secondes ou exécuter :

```sql
notify pgrst, 'reload schema';
```

### Création temporaire d’un ticket

En production, seul le launcher crée le ticket avec la session Supabase de l’utilisateur. Pour un test avant que le launcher soit branché, se connecter dans une application utilisant la clé publique puis appeler :

```javascript
const { data, error } = await supabase.rpc('create_hype_achievement_session', {
  p_ttl_seconds: 3600,
});
```

Copier temporairement `data[0].session_token` dans l’environnement du processus de test, sans le committer ni le partager.

### Appel de contrôle

```bash
curl -X POST "$AE_GAMES_SUPABASE_URL/rest/v1/rpc/record_hype_achievement_event" \
  -H "apikey: $AE_GAMES_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "p_session_token": "'"$AE_GAMES_ACHIEVEMENT_TOKEN"'",
    "p_event_id": "manual-test-0001",
    "p_achievement_key": "first-crush",
    "p_operation": "unlock",
    "p_value": null,
    "p_client_occurred_at": "2026-10-19T18:42:31Z",
    "p_metadata": {"source":"manual-test"}
  }'
```

Relancer exactement le même appel doit renvoyer `idempotent: true` et ne créer qu’un seul événement.

### Vérifications SQL

```sql
select *
from public.user_achievement_progress
order by updated_at desc;

select event_id, operation, event_value, progress_before, progress_after,
       newly_unlocked, received_at
from public.achievement_events
order by received_at desc;
```

## Critères d’acceptation

L’intégration Hype est terminée quand :

- le jeu fonctionne sans launcher ni variables d’environnement ;
- aucune clé privilégiée n’est présente dans le binaire ou le dépôt ;
- les trois déclencheurs métier envoient les bonnes clés ;
- un réseau indisponible n’affecte ni le gameplay ni les sauvegardes ;
- une nouvelle tentative ne double jamais une progression ;
- le ticket et la clé ne sont jamais loggés ;
- les tests automatisés passent ;
- le test manuel fait apparaître les progressions dans Supabase.

## Hors périmètre de cette tâche Hype

Claude ne doit pas modifier le launcher dans cette tâche. Le launcher sera branché séparément pour :

- appeler `create_hype_achievement_session` avant le lancement ;
- injecter les variables d’environnement dans `Hype.exe` ;
- appeler `revoke_hype_achievement_sessions` à l’arrêt si possible ;
- remplacer les succès factices de l’interface par `get_my_hype_achievements` ;
- écouter `user_achievement_progress` en Realtime et afficher une notification.
