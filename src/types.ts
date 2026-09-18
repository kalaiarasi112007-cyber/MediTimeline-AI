export interface MedicalEvent {
  id: string;
  date: string;
  time?: string;
  title: string;
  category:
    | "Admission"
    | "Consultation"
    | "Lab Result"
    | "Imaging"
    | "Procedure / Surgery"
    | "Prescription"
    | "Discharge"
    | "Follow-up"
    | "Vital Signs"
    | "General";
  documentType: string;
  sourceDocument: string;
  findings: string[];
  medications: string[];
  sourceSnippet: string;
  confidence: "High" | "Medium" | "Low";
}

export interface ReconciledMedication {
  name: string;
  dosage?: string;
  startDate?: string;
  status?: string;
  sourceDocument?: string;
}

export interface PatientRecord {
  id: string;
  name: string;
  age?: string;
  gender?: string;
  mrn?: string;
  lastUpdated: string;
  documentsCount: number;
  events: MedicalEvent[];
  medicationsSummary: ReconciledMedication[];
}

export interface ExtractionResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    documentName: string;
    documentType: string;
    documentDate: string;
    summary: string;
    complianceNote: string;
    events: MedicalEvent[];
    medications: Array<{
      name: string;
      dosage?: string;
      status?: string;
    }>;
    patient: {
      id: string;
      name: string;
      mrn: string;
      totalEvents: number;
    };
  };
}
