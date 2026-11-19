<p align="center"><img src="docs/header.png" alt="Ти ћути. Ти си курва." width="420"></p>

# Ti da ćutiš ti si...

Dodatak za Chrome za sve koji gledaju prenos Skupštine na YouTube-u, a ne žele da slušaju baš svakoga. Kad neko od izabranih poslanika uzme reč, dodatak ga prepozna po glasu i umesto njega ti pusti muziku po izboru. Kad on završi, vraća te na prenos i nastavljaš da gledaš kao da ništa nije bilo.

Sve radi u tvom pregledaču. Ništa se ne šalje nigde.

Trenutno prepoznaje: **Aleksandra Vučića, Anu Brnabić i Milenka Jovanova.**

## Instalacija

Poslao sam dodatak u Chrome Web Store. Kad ga odobre, instalacija će biti jedan klik, a link će stajati ovde.

Do tada ga možeš instalirati ručno. Traje oko dva minuta, nije potrebno nikakvo znanje.

**1. Preuzmi dodatak**

Na vrhu ove stranice klikni zeleno dugme **Code**, pa u meniju koji se otvori klikni **Download ZIP**. Preuzeće se fajl `ti-da-cutis-main.zip`.

**2. Raspakuj ga**

Otvori folder Downloads (Preuzimanja).
- **Mac:** dvaput klikni na `ti-da-cutis-main.zip`. Pojaviće se folder `ti-da-cutis-main`.
- **Windows:** desni klik na `ti-da-cutis-main.zip`, pa **Extract All** (Izdvoji sve), pa **Extract**.

**3. Otvori stranicu sa dodacima u Chrome-u**

U Chrome-u klikni na traku za adresu (gde inače kucaš adrese sajtova), ukucaj `chrome://extensions` i pritisni Enter.

**4. Uključi režim za programere**

U gornjem desnom uglu te stranice je prekidač **Developer mode** (na srpskom: **Režim za programere**). Uključi ga. Ne brini, ovo samo dozvoljava da instaliraš dodatak koji nije iz prodavnice.

**5. Učitaj dodatak**

Gore levo pojaviće se dugme **Load unpacked** (**Učitaj raspakovano**). Klikni ga. Otvoriće se prozor za biranje foldera. Uđi u `ti-da-cutis-main`, pa u `extension`, i izaberi folder `dist`. Klikni **Select** (Izaberi).

Dodatak „Ti da ćutiš ti si...“ sad je na listi.

**6. Zakači ikonicu da ti bude pri ruci**

Gore desno u Chrome-u klikni ikonicu slagalice (🧩), nađi „Ti da ćutiš ti si...“ i klikni čiodu pored. Ikonica sa prekriženim usnama ostaće stalno vidljiva.

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

Za ovo se koristi model za prepoznavanje govornika koji radi direktno u pregledaču. Zvuk ne napušta tvoj računar i ništa se ne šalje na internet.

Na snimcima koje nije video tokom učenja, dodatak je ova tri poslanika prepoznao skoro bez greške. Ponekad ipak može da se zabuni i ućutka nekog ko ima sličan glas.

## Uskoro

Aktivno dodajem glasove novih poslanika, između ostalih **Vojislava Šešelja, Nebojše Bakareca i Marijana Rističevića**. Nove verzije će se pojavljivati ovde.
