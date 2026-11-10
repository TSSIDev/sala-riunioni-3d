// Apparecchiature della sala CdA, con il numero di voce della proposta.
// "zone": parti visibili nel modello, da puntare col mirino. Coordinate Blender [x0, x1, y0, y1, z0, z1],
// prese dal modello Blender: se cambia il modello vanno aggiornate qui.
const DIFF = [];
for (const x of [16.8, 20.2, 23.0, 26.4]) for (const y of [2.3, 4.6]) DIFF.push([x - .3, x + .3, y - .3, y + .3, 4.85, 5.0]);

export const GRUPPI = ['Video', 'Audio', 'Al tavolo', 'Controllo', 'Rete e alimentazione'];

export const PRODOTTI = [
  // --- Video
  { voce: 8, n: 1, gruppo: 'Video', modello: 'Samsung QM98C', ruolo: 'Monitor professionale 98” 4K', dove: 'In testata',
    dati: [['Schermo', '98” 4K UHD, uso 24 ore su 24'], ['Codice', 'LH98QMCEBGCXEN']],
    nota: 'Mostra la videochiamata e le presentazioni a tutto il tavolo.',
    zone: [[13.9, 14.02, 2.35, 4.57, .93, 2.18]] },
  { voce: 9, n: 1, gruppo: 'Video', modello: 'Neomounts WL30-750BL18', ruolo: 'Staffa a parete per il 98”', dove: 'Dietro il monitor',
    dati: [['Portata', 'Fino a 125 kg, schermi fino a 98”']],
    nota: 'Fissa, a filo parete: il monitor pesa 56 kg.' },
  { voce: 7, n: 1, gruppo: 'Video', modello: 'AVer CAM570', ruolo: 'Telecamera che segue chi parla', dove: 'Sopra il monitor',
    dati: [['Ottiche', 'PTZ 4K con zoom ottico 12x e grandangolo 95°'], ['Uscite', 'USB, HDMI e rete, alimentata PoE+']],
    nota: 'Inquadra da sola chi prende la parola, anche in fondo al tavolo.',
    zone: [[13.95, 14.28, 3.28, 3.64, 2.2, 2.56]] },
  // --- Audio
  { voce: 4, n: 2, gruppo: 'Audio', modello: 'Shure MXA925', ruolo: 'Microfono a soffitto ad array', dove: 'Sospesi a 3 m',
    dati: [['Capsule', '113 microfoni MEMS'], ['Copertura', 'Automatica, fino a 8 zone'], ['Rete', 'Dante, alimentato PoE']],
    nota: 'Niente microfoni sul tavolo e nessun pulsante da premere.',
    zone: [[18.2, 19.43, 2.85, 4.07, 2.9, 3.12], [23.7, 24.93, 2.85, 4.07, 2.9, 3.12]] },
  { voce: 6, n: 8, gruppo: 'Audio', modello: 'Shure MXN5W-C', ruolo: 'Diffusore da soffitto', dove: 'Nel controsoffitto',
    dati: [['Tipo', '2 vie, woofer da 13 cm'], ['Rete', 'Dante, alimentato PoE+, senza amplificatori']],
    nota: 'Fa sentire chi è collegato a distanza e porta la voce da un capo all’altro del tavolo.',
    zone: DIFF },
  { voce: 5, n: 1, gruppo: 'Audio', modello: 'Shure IntelliMix P300-IMX', ruolo: 'Processore audio per conferenza', dove: 'Locale tecnico',
    dati: [['Funzioni', 'Cancellazione dell’eco, riduzione del rumore, mixer automatico'], ['Collegamenti', 'Dante e USB']],
    nota: 'Il cervello dell’audio: pulisce la voce e regola il rinforzo in sala su 2 zone.' },
  // --- Al tavolo
  { voce: 12, n: 1, gruppo: 'Al tavolo', modello: 'Extron UCS SW 313', ruolo: 'Selettore automatico con USB-C', dove: 'Prese sul tavolo',
    dati: [['Ingressi', 'USB-C con ricarica 60 W, 2 HDMI con USB']],
    nota: 'Un solo cavo dal portatile: schermo, telecamera, microfoni e casse della sala.',
    zone: [[18.82, 19.22, 3.29, 3.65, .74, .82], [22.32, 22.72, 3.29, 3.65, .74, .82]] },
  { voce: 15, n: 1, gruppo: 'Al tavolo', modello: 'Barco ClickShare C-10', ruolo: 'Presentazione senza fili, 2 pulsanti', dove: 'Sotto il tavolo',
    dati: [['Compatibile', 'Pulsante ClickShare, app, AirPlay, Google Cast, Miracast']],
    nota: 'Si collega il pulsante al portatile, un clic e la presentazione è sul 98”.' },
  { voce: 10, n: 1, gruppo: 'Al tavolo', modello: 'Lenovo ThinkCentre neo 50q Gen 6', ruolo: 'PC di sala, garanzia 3 anni on-site', dove: 'Sotto il tavolo',
    dati: [['Processore', 'Intel Core Ultra 7 256V'], ['Memoria', '16 GB, SSD 512 GB']],
    nota: 'Sempre pronto per Teams, Zoom, Meet e Webex, senza portare il portatile.' },
  { voce: 11, n: 1, gruppo: 'Al tavolo', modello: 'Logitech K400 Plus', ruolo: 'Tastiera senza fili con touchpad', dove: 'Sul tavolo',
    dati: [['Layout', 'Italiano, touchpad integrato']],
    nota: 'Per avviare la riunione dal PC di sala.' },
  { voce: 13, n: 1, gruppo: 'Al tavolo', modello: 'Aten VE811', ruolo: 'Estensore HDMI su cavo di rete', dove: 'Tavolo e testata',
    dati: [['Portata', '4K fino a 70 m, HDBaseT']],
    nota: 'Porta l’immagine dal tavolo al monitor, oltre 10 m più in là.' },
  { voce: 14, n: 1, gruppo: 'Al tavolo', modello: 'Aten UEH4102', ruolo: 'Estensore USB su cavo di rete', dove: 'Tavolo e testata',
    dati: [['Portata', 'Fino a 100 m, USB 2.0, 4 porte']],
    nota: 'Collega al tavolo la telecamera e il processore audio.' },
  // --- Controllo
  { voce: 16, n: 1, gruppo: 'Controllo', modello: 'Aten VK330A + VK1200', ruolo: 'Touch panel 10” e centralina', dove: 'Sul tavolo',
    dati: [['Schermo', '10,1” a sfioramento'], ['Centralina', 'Comanda monitor, telecamera e audio']],
    nota: 'Un tasto accende la sala. Da qui anche volume e scelta della sorgente.',
    zone: [[24.32, 24.72, 3.3, 3.64, .74, .84]] },
  // --- Rete e alimentazione (in comune con le altre sale)
  { voce: 29, n: 1, gruppo: 'Rete e alimentazione', modello: 'Niveo NRS24T4P-AV', ruolo: 'Switch di rete audio-video', dove: 'Locale tecnico',
    dati: [['Porte', '24 Gigabit PoE+, 4 SFP, 400 W PoE']],
    nota: 'Alimenta dal cavo di rete microfoni, casse e telecamera.' },
  { voce: 30, n: 1, gruppo: 'Rete e alimentazione', modello: 'Niveo NUPS23-1000', ruolo: 'Gruppo di continuità', dove: 'Locale tecnico',
    dati: [['Potenza', '1000 VA, a rack']],
    nota: 'Tiene accesi switch e processori se salta la corrente.' },
  { voce: 31, n: 1, gruppo: 'Rete e alimentazione', modello: 'Armadio rack 19” 22U', ruolo: 'Raccoglie gli apparati', dove: 'Locale tecnico',
    dati: [['Modello', 'Da confermare in base al locale']],
    nota: 'In comune con le altre sale.' },
];
