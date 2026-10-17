# Connexion Discord du launcher

## 1. Créer le schéma

Dans le tableau de bord Supabase, ouvrez **SQL Editor**, puis exécutez ces migrations dans l’ordre :

`supabase/migrations/202610170001_create_launcher_profiles.sql`

`supabase/migrations/202610170002_unique_profile_usernames.sql`

`supabase/migrations/202610170003_create_launcher_friendships.sql`

Elles créent `public.profiles`, les pseudos uniques, `public.friendships` et leurs politiques RLS/fonctions sécurisées. Elles ne modifient pas `public.user_roles`.

## 2. Autoriser les redirections Supabase

Dans **Authentication → URL Configuration → Redirect URLs**, ajoutez exactement :

```text
aegames://auth/callback
http://localhost:5173/
```

La première URL sert à l'application Tauri. La seconde sert uniquement au développement dans le navigateur.

## 3. Vérifier l'application Discord

Dans le portail développeur Discord, l'URL OAuth de redirection doit être celle de Supabase, et non celle du launcher :

```text
https://zdmtsgaeyfapmahffrup.supabase.co/auth/v1/callback
```

Le Client ID et le Client Secret Discord restent configurés dans **Authentication → Providers → Discord** sur Supabase.

## 4. Configuration locale

Le fichier `.env.local`, ignoré par Git, contient l'URL et la clé publique du projet. `.env.example` documente les variables attendues. Aucune clé `service_role` ne doit être ajoutée au launcher.

## Parcours d'authentification

1. Le launcher demande une connexion Discord à Supabase en PKCE.
2. Sur desktop, Discord s'ouvre dans le navigateur système.
3. Supabase redirige vers `aegames://auth/callback`.
4. Tauri renvoie l'URL à l'instance existante du launcher.
5. Le launcher échange le code temporaire et conserve la session localement.
