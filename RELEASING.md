# Publier Æ Games Launcher

Les releases Windows x64 sont compilées par GitHub Actions et publiées dans GitHub Releases. Le launcher consulte ensuite :

```text
https://github.com/aemp4prod/aegames-launcher/releases/latest/download/latest.json
```

## Secrets et variables GitHub

Le dépôt doit contenir ces secrets Actions :

- `TAURI_SIGNING_PRIVATE_KEY` : contenu de la clé privée Tauri ;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : mot de passe de cette clé.

Et ces variables Actions :

- `VITE_SUPABASE_URL` ;
- `VITE_SUPABASE_PUBLISHABLE_KEY`.

La clé publique correspondante est intégrée à `src-tauri/tauri.conf.json`. La clé privée et son mot de passe sont conservés localement dans le dossier ignoré `.tauri/`. Ils ne doivent jamais être ajoutés au dépôt. Sauvegardez-les dans un gestionnaire de secrets : sans eux, les installations existantes ne pourront plus accepter les futures mises à jour.

## Créer une version

1. Mettre à jour la même version dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`.
2. Committer les changements sur `main`.
3. Créer puis pousser un tag correspondant à la version :

```powershell
git tag launcher-v0.1.0
git push origin main --tags
```

Le workflow `.github/workflows/release.yml` compile l'installateur NSIS, signe le paquet de mise à jour et publie l'installateur, sa signature et `latest.json`.

## Tester la mise à jour

Une mise à jour n'est proposée que si la version publiée est strictement supérieure à celle installée. Pour tester le cycle après la 0.1.0, publiez par exemple une 0.1.1 puis ouvrez **Réglages → Avancé → Mises à jour du launcher** depuis la 0.1.0.

Tant qu'aucun certificat Authenticode n'est configuré, Windows peut afficher un avertissement « éditeur inconnu ». La signature Tauri reste obligatoire et protège bien le canal de mise à jour ; elle ne remplace simplement pas la signature de confiance affichée par Windows.
