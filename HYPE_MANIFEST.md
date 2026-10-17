# Hype — Spécification du manifeste de distribution

Ce document décrit le format attendu par **Æ Games Launcher** pour reconnaître, vérifier, installer et mettre à jour Hype depuis GitHub.

## Objectif

Le dépôt ou la pipeline de build de Hype doit produire :

1. une archive Windows contenant le jeu compilé ;
2. un `manifest.json` décrivant précisément cette version ;
3. idéalement, une GitHub Release contenant l'archive et une copie immuable du manifeste.

Le manifeste doit être généré **après le build final**, afin que les tailles et empreintes SHA-256 correspondent exactement aux fichiers distribués.

## Format minimal compatible aujourd'hui

Le launcher reconnaît actuellement ce format :

```json
{
  "schemaVersion": 1,
  "game": {
    "id": "hype",
    "name": "Hype"
  },
  "version": "0.16.0",
  "executable": "Hype.exe",
  "files": [
    {
      "path": "Hype.exe",
      "size": 42815488
    }
  ]
}
```

À ce stade, le launcher vérifie :

- que le manifeste correspond bien à Hype ;
- que l'exécutable déclaré existe ;
- que chaque fichier de `files` existe ;
- que sa taille en octets correspond à `size`.

Les empreintes SHA-256 et le téléchargement depuis GitHub seront branchés ultérieurement.

## Format cible recommandé

```json
{
  "schemaVersion": 1,

  "game": {
    "id": "ae.hype",
    "slug": "hype",
    "name": "Hype",
    "publisher": "Æ Games"
  },

  "version": "0.16.0",

  "release": {
    "version": "0.16.0",
    "build": 16,
    "channel": "stable",
    "releasedAt": "2026-10-16T18:00:00Z",
    "minimumLauncherVersion": "0.2.0",
    "mandatory": false
  },

  "platform": {
    "os": "windows",
    "architecture": "x64"
  },

  "executable": "Hype.exe",

  "launch": {
    "workingDirectory": ".",
    "arguments": []
  },

  "package": {
    "type": "zip",
    "url": "https://github.com/AE-Games/Hype/releases/download/v0.16.0/Hype-0.16.0-windows-x64.zip",
    "size": 842163712,
    "sha256": "SHA256_DE_L_ARCHIVE"
  },

  "files": [
    {
      "path": "Hype.exe",
      "size": 42815488,
      "sha256": "SHA256_DE_HYPE_EXE",
      "critical": true
    },
    {
      "path": "Hype_Data/globalgamemanagers",
      "size": 91842,
      "sha256": "SHA256_DU_FICHIER",
      "critical": true
    },
    {
      "path": "Hype_Data/resources.assets",
      "size": 185315328,
      "sha256": "SHA256_DU_FICHIER",
      "critical": true
    }
  ],

  "preserve": [
    "saves/**",
    "screenshots/**",
    "settings.json",
    ".ae-install.json"
  ],

  "remove": [
    "obsolete/**",
    "Hype_Data/old-bundles/**"
  ],

  "links": {
    "releaseNotes": "https://github.com/AE-Games/Hype/releases/tag/v0.16.0",
    "support": "https://discord.gg/VOTRE_SERVEUR"
  }
}
```

`version` est temporairement conservé à la racine pour rester compatible avec le launcher actuel. À terme, la source canonique sera `release.version`.

## Description des propriétés

### `schemaVersion`

Version du **format du manifeste**, et non du jeu. Elle permettra au launcher de choisir le bon parseur si le schéma évolue.

### `game`

| Propriété | Rôle |
| --- | --- |
| `id` | Identifiant technique unique et permanent. Recommandé : `ae.hype`. |
| `slug` | Identifiant court destiné aux dossiers et URLs. |
| `name` | Nom affiché du jeu. |
| `publisher` | Studio ou éditeur. |

L'identifiant `game.id` ne doit jamais changer, même si le jeu est renommé.

### `version` et `release`

| Propriété | Rôle |
| --- | --- |
| `version` | Copie temporaire de la version à la racine pour le launcher actuel. |
| `release.version` | Version visible, au format SemVer : `MAJEURE.MINEURE.CORRECTIF`. |
| `release.build` | Entier strictement croissant utilisé pour comparer deux builds. |
| `release.channel` | `stable`, `beta` ou `alpha`. |
| `release.releasedAt` | Date ISO 8601 en UTC. |
| `release.minimumLauncherVersion` | Version minimale du launcher capable d'installer cette release. |
| `release.mandatory` | Si `true`, empêche de jouer sans appliquer la mise à jour. |

Le numéro `build` ne doit jamais être réutilisé ou diminué, y compris si la version textuelle change.

### `platform`

Décrit la plateforme ciblée. Le premier build attendu est :

```json
{
  "os": "windows",
  "architecture": "x64"
}
```

### `executable`

Chemin de l'exécutable relativement à la racine de l'installation :

```json
"executable": "Hype.exe"
```

Les chemins doivent :

- utiliser `/` comme séparateur, même sous Windows ;
- être relatifs à la racine du jeu ;
- ne jamais contenir `.` ou `..` comme segment ;
- ne jamais être des chemins absolus.

`C:/Hype/Hype.exe` et `../Hype.exe` sont donc interdits.

### `launch`

Décrit le lancement du jeu :

```json
{
  "workingDirectory": ".",
  "arguments": []
}
```

Des arguments pourront être ajoutés plus tard, par exemple :

```json
"arguments": ["--launcher", "--channel=stable"]
```

### `package`

Décrit l'archive complète disponible dans la GitHub Release.

| Propriété | Rôle |
| --- | --- |
| `type` | Format de l'archive, initialement `zip`. |
| `url` | URL directe de l'asset de la GitHub Release. |
| `size` | Taille exacte de l'archive en octets. |
| `sha256` | Empreinte SHA-256 de l'archive finale. |

Le launcher vérifiera l'empreinte avant toute extraction.

### `files`

Inventaire des fichiers installés :

```json
{
  "path": "Hype.exe",
  "size": 42815488,
  "sha256": "...",
  "critical": true
}
```

| Propriété | Rôle |
| --- | --- |
| `path` | Chemin relatif dans le dossier d'installation. |
| `size` | Taille exacte en octets. |
| `sha256` | Empreinte SHA-256 du fichier. |
| `critical` | Si `true`, un fichier absent ou invalide interdit le lancement. |

Tous les fichiers nécessaires au fonctionnement du jeu doivent être listés. Les fichiers temporaires, logs, sauvegardes et données utilisateur ne doivent pas l'être.

### `preserve`

Fichiers et dossiers locaux que le launcher ne doit jamais supprimer ou remplacer pendant une mise à jour : sauvegardes, réglages, captures et métadonnées locales.

Cette liste devra correspondre aux vrais emplacements utilisés par Hype.

### `remove`

Fichiers devenus obsolètes et devant être supprimés lors de cette mise à jour.

Il est préférable de déclarer explicitement ces chemins plutôt que de supprimer automatiquement tout fichier absent de `files`, car l'installation peut contenir des données utilisateur.

### `links`

Liens facultatifs vers les notes de version et le support communautaire.

## État local du launcher

Le launcher créera séparément un fichier `.ae-install.json` dans le dossier du jeu :

```json
{
  "gameId": "ae.hype",
  "installedVersion": "0.16.0",
  "installedBuild": 16,
  "channel": "stable",
  "installedAt": "2026-10-16T18:42:00Z",
  "updatedAt": "2026-10-16T18:42:00Z",
  "source": "github-release",
  "manifestUrl": "https://raw.githubusercontent.com/AE-Games/Hype/main/manifests/stable-windows-x64.json"
}
```

Ce fichier est propre à chaque ordinateur : il ne doit pas être intégré au build ni commité dans le dépôt du jeu.

## Organisation GitHub recommandée

Dans le dépôt :

```text
Hype/
├── manifests/
│   ├── stable-windows-x64.json
│   └── beta-windows-x64.json
├── scripts/
│   └── generate-manifest.ps1
├── CHANGELOG.md
└── README.md
```

Dans chaque GitHub Release :

```text
Release v0.16.0
├── Hype-0.16.0-windows-x64.zip
└── manifest-windows-x64.json
```

Le manifeste de `main` indique la dernière version disponible du canal. Celui joint à la release est une copie immuable correspondant exactement à l'archive publiée.

## Pipeline de publication recommandé

1. Compiler Hype dans un dossier propre.
2. Retirer les fichiers de développement, logs et caches.
3. Générer l'inventaire `files` depuis ce dossier.
4. Calculer `size` et `sha256` pour chaque fichier distribué.
5. Créer l'archive ZIP depuis le contenu du dossier, sans dossier parent supplémentaire.
6. Calculer `package.size` et `package.sha256` sur le ZIP final.
7. Finaliser le manifeste avec l'URL de la release.
8. Publier le ZIP et le manifeste dans la même GitHub Release.
9. Mettre à jour le manifeste du canal dans `manifests/`.

L'archive doit extraire directement cette structure :

```text
Hype.exe
Hype_Data/
...
```

Elle ne doit pas ajouter une seconde racine comme `Hype-0.16.0/Hype.exe`, sauf si tous les chemins du manifeste et le programme d'installation sont conçus pour cela.

## Cycle prévu côté launcher

```text
Lire .ae-install.json
        ↓
Télécharger le manifeste distant du canal
        ↓
Comparer release.build et installedBuild
        ↓
Télécharger le ZIP si une mise à jour existe
        ↓
Vérifier package.size et package.sha256
        ↓
Extraire dans un dossier temporaire
        ↓
Vérifier chaque fichier extrait
        ↓
Préserver les données déclarées dans preserve
        ↓
Remplacer l'installation de manière atomique
        ↓
Supprimer les chemins déclarés dans remove
        ↓
Écrire manifest.json et .ae-install.json
```

Le launcher ne doit jamais écraser l'installation fonctionnelle avant que le téléchargement, l'extraction et la vérification de la nouvelle version soient terminés.

## À implémenter côté Hype

- Produire `Hype.exe` et tous ses fichiers dans un dossier de build propre.
- Définir les vrais chemins de sauvegardes, réglages et captures à placer dans `preserve`.
- Générer automatiquement la liste `files`, les tailles et les SHA-256.
- Créer une archive ZIP reproductible.
- Publier l'archive et le manifeste dans une GitHub Release.
- Maintenir un manifeste par canal et par plateforme.
- Exclure `.ae-install.json` du build et du dépôt.

## Compatibilité immédiate

Tant que le système de mises à jour complet n'est pas branché dans Æ Games Launcher, les champs réellement indispensables sont :

```json
{
  "schemaVersion": 1,
  "game": {
    "id": "hype",
    "name": "Hype"
  },
  "version": "0.16.0",
  "executable": "Hype.exe",
  "files": [
    {
      "path": "Hype.exe",
      "size": 42815488
    }
  ]
}
```

Le format cible peut néanmoins être généré dès maintenant : les propriétés supplémentaires seront ignorées par le launcher actuel et exploitées progressivement.
