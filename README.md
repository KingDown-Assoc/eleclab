# ÉlecLab

**ÉlecLab** est un atelier interactif, en français, pour apprendre l'**électricité**, l'**électronique**, la **logique numérique** et l'**Arduino** — du débutant au niveau supérieur. On construit des circuits à la souris, on les simule en temps réel (analogique *et* numérique), on suit des leçons progressives et on relève des missions.

C'est une application web statique (**React + Vite**), servie par **Apache** dans un conteneur **Docker**.

## Liens

- **Application en ligne** : [elec.kingdown.fr](https://elec.kingdown.fr)
- **Site de l'association KingDown** : [universe.kingdown.fr](https://universe.kingdown.fr)
- **Discord** : [discord.gg/kingdown](https://discord.gg/kingdown)
- **Fluxer** : [fluxer.gg/4opC2oyR](https://fluxer.gg/4opC2oyR)

## Fonctionnalités

- **Quatre établis** : Électricité, Électronique, Logique numérique, et un studio **Arduino**.
- **Simulation réelle** : solveur analogique (loi des nœuds / analyse nodale modifiée), solveur logique, et **co-simulation mixte** analogique ↔ numérique.
- **Breadboard Arduino ↔ circuit** : on pose une carte Arduino sur le canvas du circuit, on câble ses broches (5V, GND, D2–D13, A0–A5) à de *vrais* composants, on écrit un sketch, et la carte **pilote et lit** le circuit (un bouton allume une lampe, un potentiomètre fait varier une LED…).
- **Pédagogie** : leçons à plusieurs niveaux de lecture, exercices progressifs, missions auto-validées, glossaire et formulaire.
- **Partage** : export / import JSON des montages + **lien partageable** (le code Arduino voyage avec le montage).
- Interface sombre, responsive (desktop + mobile).

## Développement

Prérequis : **Node.js 20+**.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Build

```bash
npm run build      # bundle statique dans dist/
npm run preview    # prévisualise le build de production
```

## Tests

```bash
npm test           # suite de tests du moteur de simulation
```

## Déploiement (Docker)

L'image construit le bundle puis le sert avec Apache (`httpd:2.4-alpine`) sur le port **1210**.

```bash
docker compose up -d --build
curl -I http://127.0.0.1:1210/      # doit renvoyer 200
```

Par défaut, le conteneur est lié à `127.0.0.1:1210` (non exposé publiquement) — idéal derrière un reverse proxy. Pour un accès direct depuis le LAN, remplacer le mapping par `"1210:1210"` dans `docker-compose.yml`.

### Derrière un reverse proxy (TLS)

`deploy/reverse-proxy.example.conf` est un exemple de vhost Apache qui termine le TLS et relaie vers le conteneur. Remplacer `eleclab.example.com` par le domaine voulu et adapter les chemins de certificats. N'importe quel reverse proxy convient (Apache, nginx, Caddy, Traefik…).

## Structure du projet

```
.
├── src/
│   ├── ElecLab.jsx     # interface React (canvas, leçons, missions, inspecteur…)
│   ├── engine.js       # moteur de simulation (analogique, logique, mixte, Arduino)
│   ├── geometry.js     # positions des broches, géométrie des composants
│   ├── arduino.js      # interpréteur C++ Arduino (runtime + bibliothèque)
│   ├── builders.js     # aides à la construction de circuits
│   ├── main.jsx        # point d'entrée
│   └── index.css       # styles
├── test/               # tests du moteur
├── public/             # icônes et manifest
├── deploy/             # exemple de reverse proxy
├── Dockerfile
├── docker-compose.yml
└── httpd-eleclab.conf  # config Apache du conteneur (port, compression, cache, SPA)
```

# IA / LLM

Ce projet a été généré par Claude. Autant vous dire que moi, le dev web et l'UI
: ça me casse bien les couilles.

Pull requests par IA acceptées.
