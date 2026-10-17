# Architecture du launcher Æ Games

## Objectif

Conserver une interface web facile à développer tout en donnant à l'application Windows un accès contrôlé au système de fichiers, aux téléchargements et au lancement de processus.

## Couches

### Interface

- React, TypeScript et Vite
- Composants et textes partagés entre le navigateur et Tauri
- TanStack Query prévu pour les données distantes
- Zustand prévu pour l'état local des téléchargements

### Adaptateur launcher

L'interface ne doit jamais appeler directement le système de fichiers. Elle consomme un contrat `LauncherAdapter`.

- `MockLauncherAdapter` : simulation dans le navigateur
- `TauriLauncherAdapter` : commandes Rust dans l'application Windows

### Services distants

- Supabase Auth avec Discord
- Supabase Postgres avec RLS
- Supabase Realtime pour présence et activité
- Edge Functions pour les opérations de confiance
- Cloudflare R2 pour les builds volumineux

## Tables

- `profiles` — profil Discord et préférences publiques du joueur, implémenté
- `launcher_categories`
- `launcher_games`
- `launcher_releases`
- `launcher_user_games`
- `launcher_sessions`
- `launcher_achievements`
- `launcher_user_achievements`
- `launcher_friendships`
- `launcher_presence`
- `launcher_activity`

## Cycle d'une mise à jour

1. Charger et authentifier le manifeste de version.
2. Comparer les fichiers locaux et leurs sommes SHA-256.
3. Télécharger les éléments requis dans un dossier de staging.
4. Vérifier la taille et la somme de chaque fichier.
5. Préserver les fichiers remplacés pour permettre un retour arrière.
6. Installer la version de manière atomique.
7. Nettoyer le staging après validation.

Les sauvegardes et fichiers de configuration utilisateur doivent être explicitement exclus de la réparation.

## Phases

1. Prototype visuel local — terminé
2. Authentification Discord et schéma Supabase — implémentés
3. Intégration Tauri Windows — en cours
4. Installation, reprise, vérification, réparation et désinstallation
5. Présence, amis, succès et statistiques réelles
