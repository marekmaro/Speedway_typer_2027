/* ------------------------------------------------------------------
   Krótkie nazwy drużyn bez sponsorów ("Orlen Oil Motor Lublin" -> "Motor Lublin")
   do powiadomień push. Ta sama reguła co T.shortName w public/js/shared.js -
   test/scoring.test.js pilnuje, żeby obie wersje dawały ten sam wynik.
------------------------------------------------------------------- */
const SPONSORS = /^(Orlen Oil|Betard|PRES Grupa Deweloperska|PRES|Gezet|Bayersystem|Krono-Plast|Stelmet|Fogo|Enea|Cellfast|Abramczyk|For Nature Solutions|Zooleszcz|Texom|Arged|Ebut|Novum|Polski Cukier|H\. Skrzydlewska|Marwis\.pl|eWinner|ROW|Lokomotiv)\s+/i;

function shortName(name) {
    if (!name) return '';
    let out = String(name).replace(SPONSORS, '').trim();
    const parts = out.split(/\s+/);
    if (parts.length > 2) out = parts.slice(-2).join(' ');
    return out;
}

module.exports = { shortName, SPONSORS };
