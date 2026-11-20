# Discord IWARA video bot

Discord bot vyhľadáva verejne prehrateľné videá na IWARA a posiela ich cez
Cloudflare Worker proxy. Video nesťahuje ani neukladá. Príkazy rozpoznáva
z bežných správ v serverových kanáloch; nie sú to registrované Discord slash
commands.

## Príkazy

| Správa v Discorde | Čo urobí |
| --- | --- |
| `/embed video [vyhľadávanie]` | Vyhľadá videá podľa textu. Predvolené radenie je Relevance. |
| `/embed video [vyhľadávanie] relevance` | Zoradí výsledky podľa relevancie. |
| `/embed video [vyhľadávanie] recent` | Zoradí výsledky od najnovších; IWARA filter je `date`. |
| `/embed video [vyhľadávanie] views` | Zoradí výsledky podľa počtu pozretí. |
| `/embed video [vyhľadávanie] likes` | Zoradí výsledky podľa počtu označení Páči sa mi. |
| `/embed trending` | Vyberie video z feedu Trending. |
| `/embed popularity` | Vyberie video z feedu Popularity. |

Príklady:

```text
/embed video wuwa
/embed video wuwa recent
/embed video mmd views
/embed trending
/embed popularity
```

Zátvorky v zápise príkazu označujú miesto pre text, nepíšu sa do správy.
Filter je voliteľný posledný výraz. Ak sa vynechá, použije sa `relevance`.
Filter možno zadať aj v hranatých zátvorkách, napríklad
`/embed video [wuwa] [views]`.

Bot neponúka tieto príkazy v Discord menu, ale číta text správy. Potrebuje
preto zapnutý **Message Content Intent** v Discord Developer Portal. Pri štarte
odstráni starý globálny slash command `/embed video`, ak nájde práve tú starú
štruktúru vytvorenú týmto botom; iný `/embed` command ponechá.

## Výber a odoslanie videa

1. Bot načíta správu, ignoruje správy od iných botov a spracúva iba správy
   v serverových kanáloch.
2. Vyhľadávanie posiela na IWARA API ako `/search` s typom `videos`; feedy
   načítava z `/videos` s radením `trending` alebo `popularity`.
3. Výsledky prechádza v poradí IWARA: najprv všetky videá na aktuálnej stránke,
   potom ďalšiu stránku. Každá požiadavka načíta najviac 32 výsledkov.
4. Výsledky označené ako súkromné preskočí. Pri verejnom výsledku načíta detail
   a hľadá podpísanú prehrateľnú URL. Ak detail označí video ako súkromné,
   pokračuje na ďalší výsledok. Iné chyby IWARA oznámi a aktuálne vyhľadávanie
   ukončí. Ak IWARA poskytne viac kvalít, vyberie pôvodný zdroj alebo najvyššie
   dostupné rozlíšenie.
5. Z podpísanej URL vytvorí HTTPS odkaz cez Cloudflare Worker a pošle ho ako
   prvú odpoveď. Ako samostatnú druhú správu pošle názov videa a tlačidlo
   **Refresh**.
6. Stlačenie tlačidla znovu načíta čerstvú podpísanú URL pre to isté video
   a vráti nový proxy odkaz. Nezmení poradie ani pozíciu vyhľadávania. Tlačidlo
   môže použiť iba osoba, ktorá zadala pôvodný príkaz.

Pri opakovaní rovnakého vyhľadávania alebo feedu bot pokračuje ďalším
prehrateľným výsledkom. Pozícia je oddelená podľa používateľa a kanála a
vyhľadávania vrátane filtra. Zmena textu alebo filtra začne od prvého výsledku.
Po prejdení všetkých výsledkov ďalší rovnaký príkaz začne od začiatku. Pozícia
sa uchováva iba v pamäti procesu, najviac hodinu od posledného použitia, takže
reštart bota ju vynuluje.

## Ako je bot naprogramovaný

Bot je napísaný v **TypeScripte** a beží na **Node.js**. `tsx` spúšťa
TypeScript priamo pri vývoji aj štarte; `discord.js` zabezpečuje pripojenie
k Discord Gateway, čítanie správ, odosielanie odpovedí a obsluhu tlačidla.

Hlavné časti:

- `src/index.ts` — prihlásenie do Discordu, spracovanie správ, postup
  vyhľadávania v pamäti a interakcie s tlačidlom Refresh.
- `src/commands.ts` — rozpoznanie textových príkazov a mapovanie filtrov
  `relevance`, `recent`, `views` a `likes` na IWARA radenie.
- `src/iwara.ts` — komunikácia s IWARA API, validácia odpovedí, preskakovanie
  súkromných výsledkov, výber prehrateľného zdroja a zostavenie proxy URL.
- `src/iwara.test.ts` — automatické testy spracovania výsledkov, feedov,
  radenia a obnovenia odkazu.

Požiadavky na IWARA sa vykonávajú cez systémový `curl`, spustený bezpečne ako
samostatný proces s argumentmi. V tomto prostredí môže Node.js HTTP klient
dostať od IWARA Cloudflare anti-bot stránku namiesto JSON odpovede.
Bot vloží podpísanú IWARA URL ako zakódovaný parameter `url` do HTTPS adresy
Worker endpointu `/video.mp4`; samotný Worker zabezpečuje prenos videa. Bot
video nesťahuje ani neukladá. Podpísané URL môžu expirovať, preto slúži tlačidlo
Refresh. Texty vyhľadávania a podpísané URL sa nezapisujú do logov.

## Nastavenie

1. V Discord Developer Portal vytvorte alebo vyberte bot aplikáciu a pridajte
   jej bot používateľa.
2. Do Replit Secrets pridajte `DISCORD_BOT_TOKEN`. Token nevkladajte do zdrojového
   kódu ani do správ.
3. V **Bot → Privileged Gateway Intents** zapnite **Message Content Intent**.
4. Nainštalujte bota na server so scope `bot` a povoľte mu čítať kanál a posielať
   správy.
5. Spustite workflow **Discord IWARA Bot**.

Konfigurácia:

- Povinný secret: `DISCORD_BOT_TOKEN`
- Voliteľná premenná prostredia: `IWARA_PROXY_BASE_URL`. Predvolená hodnota je
  `https://iwara-proxy.steam8632.workers.dev`.
- V prostredí musí byť dostupný príkaz `curl`.
- Text vyhľadávania môže mať najviac 100 znakov.

## Spustenie a kontroly

V koreňovom priečinku monorepa:

```sh
pnpm --filter @workspace/discord-bot run dev
```

Typová kontrola:

```sh
pnpm --filter @workspace/discord-bot run typecheck
```

Testy:

```sh
pnpm --filter @workspace/discord-bot test
```
