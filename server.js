const express = require("express");
const fileUpload = require("express-fileupload");
const { PDFExtract } = require("pdf.js-extract");
const mammoth = require("mammoth");
const path = require("path");
const Gtts = require("gtts");       
const fs = require("fs");
const os = require("os");

const app = express();
const pdfExtract = new PDFExtract();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "5000mb" }));
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 }, abortOnLimit: true }));
app.listen(3000, "0.0.0.0");

// TO UPLOAD PDF / DOCX
app.post("/upload-pdf", async (req, res) => {
    try {
        if (!req.files || !req.files.pdfFile) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const file     = req.files.pdfFile;
        const fileName = file.name.toLowerCase();
        let fullText   = "";

        if (fileName.endsWith(".pdf")) {
            const data = await pdfExtract.extractBuffer(file.data);
            data.pages.forEach(page => {
                page.content.forEach(item => {
                    if (item.str) fullText += item.str + " ";
                });
                fullText += "\n\n";
            });

        } else if (fileName.endsWith(".docx")) {
            const result = await mammoth.extractRawText({ buffer: file.data });
            fullText     = result.value;

        } else {
            return res.status(400).json({ error: "Unsupported file type. Upload PDF or DOCX." });
        }

        if (!fullText.trim()) {
            return res.status(400).json({ error: "File contains no readable text" });
        }

        res.json({ text: fullText.trim() });

    } catch (error) {
        res.status(500).json({ error: "Failed to parse file: " + error.message });
    }
});


// DOWNLOAD TTS as MP3

app.post("/download-tts", async (req, res) => {
    try {
        const { text, lang = "en" } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: "No text provided" });
        }

        // Limit to 5000 chars to keep response times reasonable
        const safeText = text.trim().substring(0, 5000);

        // Write to a temp file then stream it back
        const tmpFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);

        const gtts = new Gtts(safeText, lang);

        await new Promise((resolve, reject) => {
            gtts.save(tmpFile, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Disposition", 'attachment; filename="tts-audio.mp3"');

        const stream = fs.createReadStream(tmpFile);
        stream.pipe(res);

        // Clean up temp file after streaming
        stream.on("end", () => {
            fs.unlink(tmpFile, () => {});
        });
        stream.on("error", (err) => {
            fs.unlink(tmpFile, () => {});
            if (!res.headersSent) {
                res.status(500).json({ error: "Stream error: " + err.message });
            }
        });

    } catch (error) {
        console.error("TTS download error:", error.message);
        res.status(500).json({ error: "Failed to generate audio: " + error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`✓ Server running at http://localhost:${PORT}`);
});
