import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { analyzeMedicalDocument } from "./services/geminiService.js";

// Load environment variables from .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Setup directories
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(__dirname, "uploads");
const patientsFilePath = path.join(dataDir, "patients.json");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(patientsFilePath)) {
  fs.writeFileSync(patientsFilePath, JSON.stringify([], null, 2));
}

// Read and write helpers for JSON storage
function readPatients() {
  try {
    const data = fs.readFileSync(patientsFilePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("[STORAGE] Error reading patients.json:", err.message);
    return [];
  }
}

function writePatients(patients) {
  try {
    fs.writeFileSync(patientsFilePath, JSON.stringify(patients, null, 2));
    console.log(`[STORAGE] Successfully saved ${patients.length} patient records.`);
  } catch (err) {
    console.error("[STORAGE] Error writing patients.json:", err.message);
  }
}

// 1. Enable CORS for all origins and headers
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  })
);

// Pre-flight handling
app.options("*", cors());

// 2. Parse JSON & Form bodies
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 3. Request Logging Middleware
app.use((req, res, next) => {
  console.log(`REQUEST: ${req.method} ${req.originalUrl}`);
  next();
});

// 4. Configure Multer for file upload (memory storage for immediate buffer processing)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (req, file, cb) => {
    console.log(`[UPLOAD] Incoming file: "${file.originalname}" (${file.mimetype})`);
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    const isDocx = /\.docx?$/i.test(file.originalname);
    if (allowed.includes(file.mimetype) || isDocx) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, JPG, PNG, DOCX, TXT.`));
    }
  },
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// Get all patient timelines
app.get("/api/patients", (req, res) => {
  const patients = readPatients();
  res.json({ success: true, patients });
});

// Get single patient timeline
app.get("/api/patients/:id", (req, res) => {
  const patients = readPatients();
  const patient = patients.find((p) => p.id === req.params.id);
  if (!patient) {
    return res.status(404).json({ success: false, error: "Patient not found" });
  }
  res.json({ success: true, patient });
});

// Primary Endpoint: Upload and analyze medical document
app.post("/api/analyze-file", upload.single("document"), async (req, res) => {
  console.log("==========================================");
  console.log("REQUEST: POST /api/analyze-file");

  try {
    // Validate file
    if (!req.file) {
      console.warn("[UPLOAD ERROR] No file found in request under field 'document'.");
      return res.status(400).json({
        success: false,
        error: "No document uploaded. Send file via FormData using key 'document'.",
      });
    }

    console.log(`[FILE RECEIVED] Name: ${req.file.originalname}, Size: ${req.file.size} bytes, Type: ${req.file.mimetype}`);

    // Save copy to uploads directory for record keeping
    const safeName = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    fs.writeFileSync(path.join(uploadsDir, safeName), req.file.buffer);

    // Validate GEMINI_API_KEY
    if (!process.env.GEMINI_API_KEY) {
      console.error("[CONFIG ERROR] GEMINI_API_KEY is not defined in environment.");
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is missing in backend/.env. Please configure your API key.",
      });
    }

    console.log("[AI] Sending document to Gemini AI for clinical timeline extraction...");
    const extraction = await analyzeMedicalDocument(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    console.log(`[AI SUCCESS] Extracted ${extraction.events?.length || 0} events for ${extraction.patientName}`);

    // Update patients.json
    const patients = readPatients();
    const candidateName = (req.body.patientName || extraction.patientName || "Patient Anonymous").trim();
    const candidateId = (req.body.patientId || extraction.patientId || "").trim();

    let patient = patients.find(
      (p) =>
        (candidateId && p.id === candidateId) ||
        p.name.toLowerCase() === candidateName.toLowerCase()
    );

    if (!patient) {
      patient = {
        id: candidateId || `pat_${Date.now()}`,
        name: candidateName,
        mrn: candidateId || `MRN-${Math.floor(10000 + Math.random() * 90000)}`,
        lastUpdated: extraction.documentDate || new Date().toISOString().split("T")[0],
        documentsCount: 1,
        events: [],
        medicationsSummary: [],
      };
      patients.push(patient);
    } else {
      patient.documentsCount = (patient.documentsCount || 0) + 1;
      patient.lastUpdated = extraction.documentDate || new Date().toISOString().split("T")[0];
    }

    // Merge events and sort chronologically
    const newEvents = (extraction.events || []).map((ev, idx) => ({
      ...ev,
      id: ev.id || `evt_${Date.now()}_${idx}`,
      sourceDocument: req.file.originalname,
      documentType: extraction.documentType || "Clinical Document",
    }));

    patient.events = [...(patient.events || []), ...newEvents];
    patient.events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Update medications list
    const currentMeds = patient.medicationsSummary || [];
    (extraction.medications || []).forEach((newMed) => {
      const exists = currentMeds.find((m) => m.name.toLowerCase() === newMed.name.toLowerCase());
      if (!exists) {
        currentMeds.push({
          name: newMed.name,
          dosage: newMed.dosage || "As prescribed",
          startDate: extraction.documentDate || new Date().toISOString().split("T")[0],
          status: newMed.status || "Active",
          sourceDocument: req.file.originalname,
        });
      }
    });
    patient.medicationsSummary = currentMeds;

    writePatients(patients);

    console.log(`[COMPLETED] Successfully returned timeline for patient ${patient.name}`);
    console.log("==========================================");

    return res.status(200).json({
      success: true,
      message: "Document successfully analyzed and added to patient timeline.",
      data: {
        documentName: req.file.originalname,
        documentType: extraction.documentType,
        documentDate: extraction.documentDate,
        summary: extraction.summary,
        complianceNote: extraction.complianceNote,
        events: extraction.events,
        medications: extraction.medications,
        patient: {
          id: patient.id,
          name: patient.name,
          mrn: patient.mrn,
          totalEvents: patient.events.length,
        },
      },
    });
  } catch (err) {
    console.error("[SERVER ERROR] Failed during analysis:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "An unexpected error occurred during document processing.",
    });
  }
});

// Global Error Handler (Guarantees JSON response, NEVER HTML)
app.use((err, req, res, next) => {
  console.error("[UNHANDLED ERROR]", err);
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({
    success: false,
    error: err.message || "Internal server error occurred.",
  });
});

// Start listening and keep server running
app.listen(PORT, "0.0.0.0", () => {
  console.log("==========================================");
  console.log("MediTimeline AI Backend");
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Ready for requests at POST http://localhost:${PORT}/api/analyze-file`);
  console.log("==========================================");
});
