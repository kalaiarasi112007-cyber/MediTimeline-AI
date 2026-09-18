import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { analyzeMedicalDocument, ExtractionResult } from "./server/geminiService.ts";

const app = express();
const PORT = 3000;

// Ensure directories exist
const dataDir = path.join(process.cwd(), "data");
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const patientsFilePath = path.join(dataDir, "patients.json");

// Helper to read patients
function readPatients(): any[] {
  try {
    if (!fs.existsSync(patientsFilePath)) {
      fs.writeFileSync(patientsFilePath, JSON.stringify([], null, 2));
      return [];
    }
    const raw = fs.readFileSync(patientsFilePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[STORAGE] Error reading patients.json:", err);
    return [];
  }
}

// Helper to write patients
function writePatients(patients: any[]): void {
  try {
    fs.writeFileSync(patientsFilePath, JSON.stringify(patients, null, 2));
    console.log(`[STORAGE] Updated patients.json with ${patients.length} patient records.`);
  } catch (err) {
    console.error("[STORAGE] Error writing patients.json:", err);
  }
}

// Configure CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  })
);

// Express body parsers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request logger middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
  next();
});

// Configure Multer storage (memory storage for immediate buffer access, plus saving copy to uploads)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30 MB max
  },
  fileFilter: (_req, file, cb) => {
    console.log(`[MULTER] Receiving file: "${file.originalname}", type: ${file.mimetype}`);
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
    ];

    const hasValidExt = /\.(pdf|jpe?g|png|webp|docx|doc|txt)$/i.test(file.originalname);
    if (allowedMimes.includes(file.mimetype) || hasValidExt) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed types: PDF, JPG, PNG, DOCX, TXT.`));
    }
  },
});

/* =========================================================================
   API ROUTES
   ========================================================================= */

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "MediTimeline AI Backend",
    version: "2.5.0",
    geminiKeyConfigured: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// Get all patients
app.get("/api/patients", (_req: Request, res: Response) => {
  console.log("[API] GET /api/patients");
  const patients = readPatients();
  res.json({
    success: true,
    patients,
  });
});

// Get specific patient by ID
app.get("/api/patients/:id", (req: Request, res: Response) => {
  const patientId = req.params.id;
  console.log(`[API] GET /api/patients/${patientId}`);
  const patients = readPatients();
  const patient = patients.find((p) => p.id === patientId);

  if (!patient) {
    return res.status(404).json({
      success: false,
      error: `Patient with ID ${patientId} not found.`,
    });
  }

  res.json({
    success: true,
    patient,
  });
});

// Delete or reset patient
app.delete("/api/patients/:id", (req: Request, res: Response) => {
  const patientId = req.params.id;
  console.log(`[API] DELETE /api/patients/${patientId}`);
  let patients = readPatients();
  const index = patients.findIndex((p) => p.id === patientId);

  if (index === -1) {
    return res.status(404).json({
      success: false,
      error: `Patient with ID ${patientId} not found.`,
    });
  }

  patients.splice(index, 1);
  writePatients(patients);

  res.json({
    success: true,
    message: `Patient ${patientId} removed.`,
    remainingPatients: patients,
  });
});

// PRIMARY ENDPOINT: Analyze uploaded medical document
app.post("/api/analyze-file", upload.single("document"), async (req: Request, res: Response, next: NextFunction) => {
  console.log("=================================================");
  console.log("[API] REQUEST: POST /api/analyze-file");

  try {
    if (!req.file) {
      console.warn("[API] No file received under field name 'document'");
      return res.status(400).json({
        success: false,
        error:
          "No file uploaded. Please send a file using FormData with the field name 'document' (PDF, JPG, PNG, or DOCX).",
      });
    }

    console.log(`[API] Processing file: ${req.file.originalname} (${req.file.size} bytes, ${req.file.mimetype})`);

    // Save backup in uploads folder
    const safeFileName = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const destinationPath = path.join(uploadsDir, safeFileName);
    fs.writeFileSync(destinationPath, req.file.buffer);
    console.log(`[API] Document saved to ${destinationPath}`);

    // Check Gemini API key
    if (!process.env.GEMINI_API_KEY) {
      console.error("[API] GEMINI_API_KEY is not defined in environment!");
      return res.status(500).json({
        success: false,
        error:
          "GEMINI_API_KEY is not configured on the server. Please set it in your environment or Settings > Secrets.",
      });
    }

    // Call Gemini intelligence engine
    console.log("[API] Invoking Gemini Medical Intelligence Engine...");
    const extraction: ExtractionResult = await analyzeMedicalDocument(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    console.log(
      `[API] Gemini extraction completed: ${extraction.events.length} events, ${extraction.medications.length} medications.`
    );

    // Update patient database (patients.json)
    const patients = readPatients();
    const candidateName = (req.body.patientName || extraction.patientName || "Patient Anonymous").trim();
    const candidateId = (req.body.patientId || extraction.patientId || "").trim();

    // Match existing patient by ID or Name
    let patient = patients.find(
      (p) =>
        (candidateId && p.id === candidateId) ||
        p.name.toLowerCase() === candidateName.toLowerCase()
    );

    if (!patient) {
      patient = {
        id: candidateId || `pat_${Date.now()}`,
        name: candidateName,
        age: req.body.patientAge || "Unspecified",
        gender: req.body.patientGender || "Unspecified",
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

    // Merge new events into patient timeline
    const existingEvents = patient.events || [];
    const newEvents = extraction.events.map((ev, index) => ({
      ...ev,
      id: ev.id || `evt_${Date.now()}_${index}`,
      sourceDocument: req.file!.originalname,
      documentType: extraction.documentType || "Medical Document",
    }));

    patient.events = [...existingEvents, ...newEvents];

    // Chronological sort: oldest date first
    patient.events.sort((a: any, b: any) => {
      const dateA = new Date(a.date).getTime() || 0;
      const dateB = new Date(b.date).getTime() || 0;
      return dateA - dateB;
    });

    // Update medication list
    const currentMeds = patient.medicationsSummary || [];
    extraction.medications.forEach((newMed) => {
      const existing = currentMeds.find(
        (m: any) => m.name.toLowerCase() === newMed.name.toLowerCase()
      );
      if (!existing) {
        currentMeds.push({
          name: newMed.name,
          dosage: newMed.dosage || "Standard dose",
          startDate: extraction.documentDate || new Date().toISOString().split("T")[0],
          status: newMed.status || "Active",
          sourceDocument: req.file!.originalname,
        });
      }
    });
    patient.medicationsSummary = currentMeds;

    writePatients(patients);

    console.log(`[API] Successfully updated patient record: ${patient.name} (${patient.id})`);
    console.log("=================================================");

    return res.status(200).json({
      success: true,
      message: "Medical document analyzed successfully.",
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
  } catch (err: any) {
    console.error("[API] Error in /api/analyze-file:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "An unexpected error occurred during medical document processing.",
    });
  }
});

// Load built-in sample medical document for 1-click hackathon demo
app.post("/api/sample-document", async (req: Request, res: Response) => {
  console.log("[API] POST /api/sample-document - Loading demo case");
  try {
    const { sampleType } = req.body;
    const patients = readPatients();

    let samplePatient: any = null;

    if (sampleType === "cardio_discharge") {
      samplePatient = {
        id: `demo_${Date.now()}`,
        name: "Robert M. Vance",
        age: "64",
        gender: "Male",
        mrn: "MRN-67104",
        lastUpdated: "2024-04-18",
        documentsCount: 2,
        events: [
          {
            id: `evt_demo_1`,
            date: "2024-04-10",
            time: "03:45 AM",
            title: "Emergency Department Admission - Acute Coronary Syndrome",
            category: "Admission",
            documentType: "Emergency Admission Report",
            sourceDocument: "RobertVance_ED_Admission_0410.pdf",
            findings: [
              "Substernal crushing chest pain radiating to left jaw, onset 2 hours prior",
              "ECG showed 2mm ST-elevation in leads V2-V4",
              "Initial Troponin I elevated at 4.2 ng/mL (normal <0.04 ng/mL)",
              "Blood pressure 162/98 mmHg, SpO2 94% on room air"
            ],
            medications: [
              "Aspirin 324mg chewable PO administered stat",
              "Ticagrelor 180mg PO loading dose",
              "Atorvastatin 80mg PO stat",
              "Unfractionated heparin bolus and infusion protocol"
            ],
            sourceSnippet: "Patient arrived via EMS with acute severe chest pain. EKG diagnostic for anterior STEMI. Emergent cardiac catheterization laboratory activated.",
            confidence: "High"
          },
          {
            id: `evt_demo_2`,
            date: "2024-04-10",
            time: "05:15 AM",
            title: "Percutaneous Coronary Intervention (PCI)",
            category: "Procedure / Surgery",
            documentType: "Interventional Cardiology Operative Note",
            sourceDocument: "PCI_Operative_Record_0410.pdf",
            findings: [
              "Coronary angiography revealed 95% thrombotic occlusion of proximal LAD",
              "Left circumflex and right coronary artery showed mild diffuse disease (<30%)",
              "Successful deployment of drug-eluting stent (Xience Sierra 3.5 x 24mm)",
              "TIMI 3 flow restored with 0% residual stenosis"
            ],
            medications: [
              "Intracoronary nitroglycerin 200mcg",
              "Dual Antiplatelet Therapy (DAPT) protocol initiated"
            ],
            sourceSnippet: "Angiogram: 95% proximal LAD lesion with haziness. Successful direct stenting with drug-eluting stent. Post-dilation performed; final TIMI 3 flow achieved.",
            confidence: "High"
          },
          {
            id: `evt_demo_3`,
            date: "2024-04-12",
            time: "10:00 AM",
            title: "Post-PCI Transthoracic Echocardiogram",
            category: "Imaging",
            documentType: "Echocardiography Report",
            sourceDocument: "Echo_PostPCI_0412.pdf",
            findings: [
              "LVEF moderately depressed at 45%",
              "Hypokinesis of anterior and anteroseptal walls",
              "No pericardial effusion or intracardiac thrombus"
            ],
            medications: [],
            sourceSnippet: "Transthoracic Echo: LVEF calculated at 45% by biplane Simpson's method. Wall motion abnormality consistent with anterior infarction.",
            confidence: "High"
          },
          {
            id: `evt_demo_4`,
            date: "2024-04-14",
            time: "02:30 PM",
            title: "Inpatient Hospital Discharge Summary",
            category: "Discharge",
            documentType: "Hospital Discharge Summary",
            sourceDocument: "RobertVance_DischargeSummary_0414.pdf",
            findings: [
              "Patient ambulating ad lib without recurrent chest pain or arrhythmia",
              "Predischarge labs: Creatinine 1.0 mg/dL, Potassium 4.4 mEq/L",
              "Outpatient cardiac rehabilitation referral placed"
            ],
            medications: [
              "Aspirin 81mg PO daily indefinitely",
              "Ticagrelor 90mg PO twice daily for 12 months",
              "Atorvastatin 80mg PO every night at bedtime",
              "Metoprolol Succinate 25mg PO daily",
              "Ramipril 2.5mg PO daily"
            ],
            sourceSnippet: "Condition at discharge: Stable, pain-free. Emphasized strict compliance with dual antiplatelet therapy to prevent in-stent thrombosis. Follow-up in 2 weeks.",
            confidence: "High"
          }
        ],
        medicationsSummary: [
          { name: "Aspirin", dosage: "81mg daily", startDate: "2024-04-10", status: "Active" },
          { name: "Ticagrelor", dosage: "90mg BID", startDate: "2024-04-10", status: "Active" },
          { name: "Atorvastatin", dosage: "80mg QHS", startDate: "2024-04-10", status: "Active" },
          { name: "Metoprolol Succinate", dosage: "25mg daily", startDate: "2024-04-14", status: "Active" },
          { name: "Ramipril", dosage: "2.5mg daily", startDate: "2024-04-14", status: "Active" }
        ]
      };
    } else {
      samplePatient = {
        id: `demo_${Date.now()}`,
        name: "Eleanor Brooks",
        age: "42",
        gender: "Female",
        mrn: "MRN-39182",
        lastUpdated: "2024-02-28",
        documentsCount: 2,
        events: [
          {
            id: `evt_demo_lab1`,
            date: "2024-02-14",
            time: "08:15 AM",
            title: "Comprehensive Metabolic Panel & Thyroid Screen",
            category: "Lab Result",
            documentType: "Outpatient Laboratory Report",
            sourceDocument: "Brooks_LabPanel_Feb14.pdf",
            findings: [
              "TSH elevated at 7.82 mIU/L (reference range: 0.40 - 4.50 mIU/L)",
              "Free T4 mildly low at 0.72 ng/dL (reference range: 0.80 - 1.80 ng/dL)",
              "Fasting Blood Glucose normal at 88 mg/dL",
              "Total Cholesterol 218 mg/dL, LDL 136 mg/dL"
            ],
            medications: [],
            sourceSnippet: "Results show primary hypothyroidism with elevated TSH (7.82) and low-normal free thyroxine. Lipid profile reveals mild hypercholesterolemia.",
            confidence: "High"
          },
          {
            id: `evt_demo_lab2`,
            date: "2024-02-28",
            time: "10:30 AM",
            title: "Endocrinology Clinical Evaluation",
            category: "Consultation",
            documentType: "Clinical Consultation Note",
            sourceDocument: "Endocrinology_Note_Feb28.pdf",
            findings: [
              "Patient reports progressive lethargy, cold intolerance, and dry skin over 4 months",
              "Thyroid palpation reveals smooth, non-tender diffuse thyromegaly without discrete nodules",
              "Reflexes show delayed relaxation phase"
            ],
            medications: [
              "Levothyroxine 50mcg PO every morning on empty stomach initiated",
              "Advised to take 60 minutes before breakfast with water"
            ],
            sourceSnippet: "Assessment: Symptomatic primary hypothyroidism. Plan: Initiate Levothyroxine 50mcg daily. Repeat TSH and FT4 in 6-8 weeks.",
            confidence: "High"
          }
        ],
        medicationsSummary: [
          { name: "Levothyroxine", dosage: "50mcg every morning", startDate: "2024-02-28", status: "Active" }
        ]
      };
    }

    patients.unshift(samplePatient);
    writePatients(patients);

    res.json({
      success: true,
      message: `Sample patient record "${samplePatient.name}" loaded successfully.`,
      patient: samplePatient,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================================
   GLOBAL ERROR HANDLER (Ensures JSON is ALWAYS returned, never HTML)
   ========================================================================= */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[SERVER_ERROR] Caught unhandled exception:", err);

  const statusCode = err.status || (err instanceof multer.MulterError ? 400 : 500);

  res.status(statusCode).json({
    success: false,
    error: err.message || "An unexpected server error occurred.",
    code: err.code || "SERVER_ERROR",
  });
});

/* =========================================================================
   VITE MIDDLEWARE (Full-stack dev + production static serve)
   ========================================================================= */
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("[SERVER] Starting Vite in development middleware mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[SERVER] Serving production static build from dist...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`=================================================`);
    console.log(` MediTimeline AI Backend`);
    console.log(` Server listening on http://0.0.0.0:${PORT}`);
    console.log(` Health check: http://localhost:${PORT}/api/health`);
    console.log(` Analysis API: http://localhost:${PORT}/api/analyze-file`);
    console.log(`=================================================`);
  });
}

startServer().catch((err) => {
  console.error("[FATAL] Server failed to start:", err);
});
