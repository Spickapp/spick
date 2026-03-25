Instruktioner för Google Search Console:
# Google Search Console Setup

## Steg 1 – Lägg till sajten
1. Gå till https://search.google.com/search-console
2. Klicka "Add property"
3. Välj "URL prefix" och skriv: https://spick.se

## Steg 2 – Verifiera (HTML-tagg metoden)
1. Välj "HTML tag"
2. Kopiera verifieringskoden (ser ut som: `abc123def456`)
3. Öppna index.html i repot
4. Hitta raden: `<!-- <meta name="google-site-verification" content="XXXX"> -->`
5. Ersätt XXXX med din kod och ta bort kommentar-taggarna

## Steg 3 – Skicka in sitemap
1. I Search Console, gå till Sitemaps
2. Skriv in: `sitemap.xml`
3. Klicka Submit

## Steg 4 – Microsoft Clarity (heatmaps)
1. Gå till https://clarity.microsoft.com
2. Skapa gratis konto
3. Skapa nytt projekt: "Spick"
4. Kopiera projekt-ID (ser ut som: `abcd1234`)
5. I index.html, byt ut `spick01` mot ditt projekt-ID
6. Gör samma i stadare.html, boka.html, bli-stadare.html

## Automatiskt
- Sitemap pingad till Google + Bing varje gång den uppdateras
- FAQ rich snippets på /faq.html
- HowTo rich snippets på /hur-det-funkar.html
- LocalBusiness schema på alla 19 stadssidor
