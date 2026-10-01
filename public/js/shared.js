/* ------------------------------------------------------------------
   Wspólne narzędzia dla wszystkich stron (main / typuj / admin).
   Wcześniej te same funkcje były skopiowane w 4 plikach i rozjeżdżały się.
------------------------------------------------------------------- */
window.T = (function () {

    const LOGOS = {
        "PRES Grupa Deweloperska Toruń": "https://v.wpimg.pl/MDc4NzEuYiUCVjhJag5vMEEObBMsV2FmFhZ0WGpBdTxMRygNNVs6NABQIFQ1GWIwAlM9VXNMfCBaBX4fJ0IvfAUGEUl9QH1zWwN_VDUbKmYe",
        "Orlen Oil Motor Lublin": "https://v.wpimg.pl/MjQ1NDIuYgswUzh3Zg5vHnMLbC0gV2FIJBN0ZmZBdRJ-QigzOVs6GjJVIGo5GWIeMFY9a3xNK1hnAC12fUQrXDIJEXN8RH9eZAV8ajkbKkgs",
        "Betard Sparta Wrocław": "https://v.wpimg.pl/NDQ3NzUuYSUwUThJeg5sMHMJbBM8V2JmJBF0WHpBdjx-QCgNJVs5NDJXIFQlGWEwMFQ9VWNHfXU1BS8ZZ0J6J2UHEU9jR3pwZgR7VCUbKWYs",
        "Bayersystem GKM Grudziądz": "https://v.wpimg.pl/MzI3OTUuYhsoUTlneg5vDmsJbT08V2FYPBF1dnpBdQJmQCkjJVs6CipXIXolGWIOKFQ8e2AQeB57V3tgNkZ1Sn8GEGVhR35Ifgp6eiUbKlg0",
        "Stelmet Falubaz Zielona Góra": "https://v.wpimg.pl/OTAxMDMuYDUgGjt3Yg5tIGNCby0kV2N2NFp3ZmJBdyxuCyszPVs4JCIcI2o9GWAgIB8-a3tAdmF4TXwhexQrZCVLEnx4TXZkcEh-aj0bKHY8",
        "Krono-Plast Włókniarz Częstochowa": "https://v.wpimg.pl/NTQ0MzYuYTUwUjtJdg5sIHMKbxMwV2J2JBJ3WHZBdix-QysNKVs5JDJUI1QpGWEgMFc-VWwQezBjUStPa0B4YmcDEk1gR3tgZQN7VCkbKXYs",
        "Gezet Stal Gorzów": "https://v.wpimg.pl/MDE2OTMuYiUkUDlnYg5vMGcIbT0kV2FmMBB1dmJBdTxqQSkjPVs6NCZWIXo9GWIwJFU8e3gQeCB3UXpseBR-dHYFEGB1RX11cwt8ej0bKmY4",
        "Fogo Unia Leszno": "https://v.wpimg.pl/OTM2MjAuYDUsUDtZbg5tIG8IbwMoV2N2OBB3SG5BdyxiQSsdMVs4JC5WI0QxGWAgLFU-RXQQejB-A3sPcBd5NikKElp3RXZnewB9RDEbKHYw"
    };

    // Przedrostki sponsorskie do ucięcia w wersji skróconej nazwy
    const SPONSORS = /^(Orlen Oil|Betard|PRES Grupa Deweloperska|PRES|Gezet|Bayersystem|Krono-Plast|Stelmet|Fogo|Enea|Cellfast|Abramczyk|For Nature Solutions|Zooleszcz|Texom|Arged|Ebut|Novum|Polski Cukier|H\. Skrzydlewska|Marwis\.pl|eWinner|ROW|Lokomotiv)\s+/i;

    function shortName(name) {
        if (!name) return '';
        let out = String(name).replace(SPONSORS, '').trim();
        const parts = out.split(/\s+/);
        if (parts.length > 2) out = parts.slice(-2).join(' ');
        return out;
    }

    function initials(name) {
        return shortName(name).split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
    }

    /** Logo drużyny; gdy nie znamy adresu (np. nowy sezon) rysujemy kółko z inicjałami. */
    function logoHtml(name, cls = 'team-logo') {
        const url = LOGOS[name];
        if (url) {
            return `<img src="${url}" alt="" class="${cls}" loading="lazy"
                onerror="this.outerHTML='<span class=&quot;team-badge&quot;>${initials(name)}</span>'">`;
        }
        return `<span class="team-badge">${initials(name)}</span>`;
    }

    const pad = n => String(n).padStart(2, '0');

    function fmtDateTime(d) {
        return new Date(d).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function fmtDate(d) {
        return new Date(d).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function fmtDay(d) {
        return new Date(d).toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit' });
    }

    /** "2d 04h 12m 08s" albo "—" gdy czas minął. */
    function countdown(targetMs, now = Date.now()) {
        const diff = targetMs - now;
        if (diff <= 0) return null;
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    function lockTime(match, lockHours) {
        return new Date(match.matchDate).getTime() - lockHours * 3600 * 1000;
    }
    function isLocked(match, lockHours, now = Date.now()) {
        return now >= lockTime(match, lockHours);
    }

    function roundName(round, stageNames) {
        if (stageNames && stageNames[round]) return stageNames[round];
        return `Runda ${round}`;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function getJson(url) {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`);
        return data;
    }

    async function postJson(url, body, headers = {}) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body || {})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`);
        return data;
    }

    function toast(msg, kind = 'ok') {
        let box = document.getElementById('t-toast');
        if (!box) {
            box = document.createElement('div');
            box.id = 't-toast';
            box.className = 'toast-box';
            document.body.appendChild(box);
        }
        box.textContent = msg;
        box.className = `toast-box show ${kind === 'err' ? 'toast-err' : 'toast-ok'}`;
        clearTimeout(box._timer);
        box._timer = setTimeout(() => { box.className = 'toast-box'; }, 3200);
    }

    return { LOGOS, shortName, initials, logoHtml, fmtDate, fmtDateTime, fmtDay, countdown, lockTime, isLocked, roundName, escapeHtml, getJson, postJson, toast, pad };
})();
