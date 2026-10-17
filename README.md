# Æ Games Launcher

Launcher Windows Æ Games construit avec React, TypeScript, Supabase et Tauri.

## Démarrage

```powershell
pnpm install
pnpm run dev
```

Copiez `.env.example` vers `.env.local`, puis renseignez l’URL et la clé publique Supabase du projet avant le premier test de connexion Discord.

## Vérification

```powershell
pnpm run build
```

Les builds de release et les mises à jour automatiques sont produits par GitHub Actions. Consultez [RELEASING.md](./RELEASING.md) pour publier une nouvelle version.

## État actuel

- Connexion Discord réelle avec session persistante
- Profil et statut sauvegardés dans Supabase
- Tableau de bord et activité récente
- Navigation par catégories de jeux
- Fiche FiveM L.A LifeRP
- Fiche Æ Originals Hype
- Installation locale, vérification et lancement de Hype via Tauri
- Installation NSIS et mises à jour signées via GitHub Releases
- Interface entièrement en français
