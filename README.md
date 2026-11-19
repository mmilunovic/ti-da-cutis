<p align="center"><img src="docs/header.png" alt="Ти ћути. Ти си курва." width="420"></p>

# Ti da ćutiš ti si...

**[tidacutis.rs](https://tidacutis.rs)**

Dodatak za Chrome za sve koji gledaju prenos Skupštine na YouTube-u, a ne žele da slušaju baš svakoga. Kad neko od izabranih poslanika uzme reč, dodatak ga prepozna po glasu i umesto njega ti pusti muziku po izboru. Kad on završi, vraća te na prenos i nastavljaš da gledaš kao da ništa nije bilo.

Trenutno prepoznaje: **Aleksandra Vučića, Anu Brnabić i Milenka Jovanova.**

## Instalacija

Najlakše je preuzeti dodatak sa [tidacutis.rs](https://tidacutis.rs). Poslao sam dodatak u Chrome Web Store. Kad ga odobre, instalacija će biti jedan klik, a link će stajati ovde.

Do tada ga možeš instalirati ručno, za minut:

1. Klikni zeleno dugme **Code** na vrhu ove stranice, pa **Download ZIP**, i raspakuj fajl.
2. U Chrome-u otvori `chrome://extensions` i gore desno uključi **Developer mode** (Režim za programere).
3. Gore levo klikni **Load unpacked** (Učitaj raspakovano) i izaberi folder `dist`. Nalazi se u raspakovanom folderu, unutar foldera `extension`.
4. Klikni ikonicu slagalice pored polja za adresu i zakači „Ti da ćutiš ti si...“ da ti bude pri ruci.

## Kako se koristi

1. Otvori prenos Skupštine na YouTube-u i pusti ga.
2. Klikni ikonicu sa prekriženim usnama.
3. U polje za muziku nalepi link bilo koje pesme sa YouTube-a.
4. Proveri koga želiš da ućutkaš (svi su čekirani).
5. Klikni zeleno dugme **Start on this tab**.

To je to. Kad neko sa liste priča duže od par sekundi, otvoriće se tvoja pesma u novoj kartici i sviraće u krug. Kad on završi, pesma staje i vraćaš se na prenos. Sledeći put kad krene, pesma nastavlja odakle je stala.

Dobro je znati:
- Prve 2–3 sekunde njihovog govora ćeš ipak čuti. Toliko treba dodatku da bude siguran ko priča.
- Kratka dobacivanja iz klupe ne prekida, samo pravo izlaganje.
- Ako Chrome ne pusti muziku sam od sebe, u kartici sa pesmom pojaviće se poruka da klikneš bilo gde. Jedan klik i dalje radi samo.
- Kad ti više ne treba, klikni ikonicu pa **Stop**.

## Kako radi

Dodatak sluša zvuk iz kartice sa prenosom. Svakih pola sekunde uzme poslednju sekundu i po govora i napravi od nje „otisak glasa“, nešto kao otisak prsta, samo za glas. Taj otisak uporedi sa otiscima poslanika sa liste. Kad se isti poslanik poklapa oko dve sekunde zaredom, pušta muziku. Kad progovori neko drugi, muzika staje.

Za ovo se koristi model za prepoznavanje govornika koji radi direktno u pretraživaču. Zvuk ne napušta tvoj računar i ništa se ne šalje na internet.

Na snimcima koje nije video tokom učenja, dodatak je ova tri poslanika prepoznao skoro bez greške. Ponekad ipak može da se zabuni i ućutka nekog ko ima sličan glas.

## Uskoro

Aktivno dodajem glasove novih poslanika, između ostalih **Vojislava Šešelja, Nebojše Bakareca i Marijana Rističevića**.
