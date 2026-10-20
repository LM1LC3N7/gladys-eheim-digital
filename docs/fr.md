# EHEIM Digital pour Gladys

Affiche vos appareils d'aquarium **EHEIM Digital** dans Gladys par votre
réseau local, sans cloud ni compte. **Jamais testé avec un vrai appareil.
Sans lien avec EHEIM.**

## Appareils pris en charge

| Appareil                    | Ce que Gladys affiche                                                                       | Commandes                       |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| thermocontrol+e (chauffage) | température de l'eau, consigne, chauffe, marche/arrêt, mode, alerte                         | consigne, marche/arrêt (option) |
| classicVARIO+e (filtre)     | pompe marche/arrêt, vitesse (%), mode, état, heures avant l'entretien                       | pompe marche/arrêt (option)     |
| professionel 5e (filtre)    | pompe marche/arrêt, fréquence (Hz), mode, heures avant l'entretien, temps de fonctionnement | pompe marche/arrêt (option)     |
| pHcontrol+e                 | pH, consigne de pH, vanne CO2 ouverte, état, jours avant l'étalonnage                       | aucune                          |
| classicLEDcontrol+e         | niveau de chaque canal (%)                                                                  | aucune                          |
| reeflexUV+e                 | lampe allumée, actif, mode                                                                  | aucune                          |
| autofeeder+                 | poids de nourriture (g), tambour, rotation                                                  | aucune                          |

Les autres appareils EHEIM Digital ne sont pas encore affichés.

## Installation

1. Trouvez l'adresse de votre hub : l'appareil EHEIM relié à votre Wi-Fi
   (les autres le rejoignent par le maillage EHEIM). Son adresse IP est dans
   votre box ; `eheimdigital.local` fonctionne souvent aussi. Donnez-lui une
   adresse fixe.
2. Dans Gladys, installez l'intégration, saisissez l'adresse, enregistrez.
3. Ouvrez l'onglet **Découverte** et ajoutez les appareils.

Le statut indique combien d'appareils répondent. **Tester la connexion** se
connecte tout de suite et interroge à nouveau les appareils.

## Animaux vivants : les commandes

Un chauffage ou un filtre d'aquarium qui s'arrête peut tuer les poissons.
Donc :

- **Toutes les commandes sont désactivées par défaut.** « Autoriser les
  commandes du chauffage » permet à Gladys de changer la consigne et de
  mettre le chauffage en marche ou à l'arrêt ; « Autoriser les commandes du
  filtre » lui permet de démarrer et d'arrêter la pompe du filtre. Sans son
  option, une commande est refusée **dans les deux sens** : l'arrêt du
  chauffage ou du filtre est refusé aussi.
- **Jamais d'interrupteur** : le chauffage et la pompe du filtre sont des
  listes (Marche/Arrêt). Un « tout éteindre » d'un assistant vocal, d'une
  scène ou d'un tableau de bord ne les atteint jamais.
- **La consigne reste entre le plancher et le plafond** de la
  configuration : 22 °C et 28 °C par défaut ; le plancher de 18 à 30 °C, le
  plafond de 20 à 32 °C. Rien hors de 18–32 °C n'est jamais envoyé, quoi
  qu'on saisisse. Demi-degrés seulement. Un plancher égal ou supérieur au
  plafond refuse toute consigne, et le statut le dit.
- « Marche » est refusée quand la consigne réglée sur le chauffage lui-même
  est hors des bornes. Un chauffage réglé en °F n'est jamais commandé (les
  valeurs sont affichées en °C).
- Chaque commande demande d'abord ses données actuelles à l'appareil et
  décide sur cette réponse, revérifie les options et les bornes juste avant
  l'envoi, et part dans les 3,5 s ou pas du tout. Si l'appareil ne montre
  pas le changement à 4,3 s, Gladys répond « Commande envoyée, sans
  confirmation » : vérifiez l'appareil. Une commande à la fois, jamais
  rejouée.

Le contrôleur de pH, l'éclairage, le stérilisateur UV et le distributeur de
nourriture sont en lecture seule.

## Options

| Option                               | Par défaut |                                                     |
| ------------------------------------ | ---------- | --------------------------------------------------- |
| Adresse du hub                       | —          | adresse IPv4 ou nom d'hôte, port 80 sauf précisé    |
| Autoriser les commandes du chauffage | désactivé  | consigne et marche/arrêt                            |
| Plancher de la consigne (°C)         | 22         | de 18 à 30                                          |
| Plafond de la consigne (°C)          | 28         | de 20 à 32 (jamais plus de 32 °C)                   |
| Autoriser les commandes du filtre    | désactivé  | pompe marche/arrêt                                  |
| Intervalle de rafraîchissement (s)   | 30         | de 15 à 600                                         |
| Langue                               | français   | noms des nouvelles fonctionnalités, textes, erreurs |

## Sécurité et vie privée

Le protocole local n'est pas documenté par EHEIM et n'a pas de mot de
passe : toute personne sur votre réseau peut parler au hub. Gardez-le sur
un réseau de confiance. L'intégration ne garde aucun secret et ne lit
jamais l'adresse e-mail ni le nom d'utilisateur enregistrés dans le hub.
Les journaux ne contiennent jamais les adresses MAC.

## Limites

- Jamais testé avec un vrai appareil : construit à partir de la
  bibliothèque eheimdigital (celle de Home Assistant) et de ses captures.
- Le hub doit être joignable depuis le conteneur de Gladys (même réseau).
- Vitesses du filtre, programmes d'éclairage, consignes de pH et
  distribution de nourriture ne sont pas commandés dans cette version.

## Crédits

Protocole porté depuis [eheimdigital](https://codeberg.org/autinerd/eheimdigital)
(autinerd, MIT). Source : <https://github.com/LM1LC3N7/gladys-eheim-digital>.
