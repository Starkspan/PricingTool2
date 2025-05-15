
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import vision from '@google-cloud/vision';

const app = express();
const port = process.env.PORT || 3001;
const upload = multer({ dest: 'uploads/' });
const client = new vision.ImageAnnotatorClient();

app.use(cors());

const MATERIAL_PREISE = {
  aluminium: 7.0,
  edelstahl: 6.5,
  stahl: 1.5,
  messing: 8.0,
  kupfer: 10.0
};

app.post('/pdf/analyze', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const stueckzahl = parseInt(req.body.stueckzahl || '1');
    const material = req.body.material?.toLowerCase() || 'aluminium';

    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "Nur Bilddateien erlaubt." });
    }

    const [result] = await client.textDetection(file.path);
    const text = result.fullTextAnnotation?.text || '';
    const zeilen = text.split(/\r?\n/).map(z => z.toLowerCase());

    const preis_pro_kg = MATERIAL_PREISE[material] || 7.0;

    // Maße extrahieren
    const mmWerte = text.match(/\d+(\.\d+)?\s?mm/g) || [];
    const zahlen = mmWerte.map(e => parseFloat(e.replace(/[^\d.]/g, '')));
    zahlen.sort((a, b) => b - a);
    const [l, b, d] = [zahlen[0] || 100, zahlen[1] || 50, zahlen[2] || 10];

    // Komplexität prüfen (Toleranzen im µ-Bereich)
    const micronHinweis = text.match(/\d+\s?[µu]m/) || [];
    if (micronHinweis.length > 0) {
      return res.json({ manuell: true });
    }

    // Rohgewicht in kg (Dichte 2.7 g/cm³ für Alu)
    const volumen_cm3 = (l / 10) * (b / 10) * (d / 10);
    const dichte = 2.7; // Aluminium
    const rohgewicht_kg = volumen_cm3 * dichte / 1000;
    const materialkosten = rohgewicht_kg * preis_pro_kg;

    // Laufzeitabschätzung: Länge + 1 min pro 100 mm + Extras
    let laufzeit_min = l / 100 + 2;
    const features = ['gewinde', 'bohrung', 'nut', 'tasche', 'fräsung'];
    features.forEach(f => {
      const gefunden = zeilen.filter(z => z.includes(f)).length;
      laufzeit_min += gefunden * 0.5;
    });

    // Preisberechnung
    const ruest = 60;
    const prog = 30;
    const bearb_kosten = (laufzeit_min / 60) * 35;
    let preis_pro_stk = ((ruest + prog) / stueckzahl) + materialkosten + bearb_kosten;
    preis_pro_stk *= 1.15; // 15% Gewinn

    res.json({
      preis: preis_pro_stk,
      laenge: l,
      breite: b,
      dicke: d,
      laufzeit_min: laufzeit_min,
      materialkosten: materialkosten,
      rohgewicht: rohgewicht_kg,
      material: material,
      text: text.slice(0, 300)
    });

    fs.unlink(file.path, () => {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Analyse fehlgeschlagen.' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Profi-Server läuft auf Port ${port}`);
});
