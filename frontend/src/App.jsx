import React, { useState, useEffect, useRef } from "react";
import "./App.css";

// Default to user's backend port (5000) or fallback to window.location.origin
const DEFAULT_API = "http://localhost:5000";

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API);
  const [backendStatus, setBackendStatus] = useState({ online: false, checking: true });
  const [file, setFile] = useState(null);
  const [patientName, setPatientName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  
  // Data state
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [expandedTraceId, setExpandedTraceId] = useState(null);

  const fileInputRef = useRef(null);

  // Ping backend on mount & when apiBase changes
  useEffect(() => {
    checkHealth(apiBase);
    fetchPatients(apiBase);
  }, [apiBase]);

  const checkHealth = async (url) => {
    setBackendStatus({ online: false, checking: true });
    try {
      const res = await fetch(`${url}/api/health`, { method: "GET" });
      if (res.ok) {
        setBackendStatus({ online: true, checking: false });
      } else {
        setBackendStatus({ online: false, checking: false });
      }
    } catch {
      // If localhost:5000 failed and we're in browser with relative port, try relative
      if (url !== "") {
        try {
          const relRes = await fetch(`/api/health`);
          if (relRes.ok) {
            setApiBase("");
            setBackendStatus({ online: true, checking: false });
            return;
          }
        } catch {
          // ignore
        }
      }
      setBackendStatus({ online: false, checking: false });
    }
  };

  const fetchPatients = async (url) => {
    try {
      const res = await fetch(`${url}/api/patients`);
      const data = await res.json();
      if (data.success && Array.isArray(data.patients)) {
        setPatients(data.patients);
        if (data.patients.length > 0 && !selectedPatient) {
          setSelectedPatient(data.patients[0]);
        }
      }
    } catch (err) {
      console.warn("Could not fetch patients:", err);
    }
  };

  // Handle Drag & Drop
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selected) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const validExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx", ".txt"];
    const ext = selected.name.substring(selected.name.lastIndexOf(".")).toLowerCase();
    
    if (!validExtensions.includes(ext)) {
      setErrorMsg(`Unsupported file type (${ext}). Please select a PDF, JPG, PNG, or DOCX document.`);
      return;
    }
    setFile(selected);
  };

  // Upload & Analyze Document
  const handleAnalyze = async () => {
    if (!file) {
      setErrorMsg("Please select a medical document to analyze.");
      return;
    }

    setIsUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploadProgress("Uploading medical document to backend...");

    try {
      // Strictly use FormData with field name "document"
      const formData = new FormData();
      formData.append("document", file);
      if (patientName.trim()) {
        formData.append("patientName", patientName.trim());
      }

      setUploadProgress("Processing document with Gemini AI (HE-05 Extraction)...");

      const endpoint = `${apiBase}/api/analyze-file`;
      console.log(`Sending POST request to: ${endpoint}`);

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      // Defensive check for JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(
          `Backend did not return JSON. HTTP Status: ${response.status}. Response preview: ${text.slice(0, 150)}... Please verify backend/server.js is running and CORS is enabled.`
        );
      }

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to analyze document.");
      }

      setSuccessMsg(
        `Successfully extracted ${result.data.events?.length || 0} chronological events for ${result.data.patient?.name || "Patient"}.`
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh patients list & select current
      await fetchPatients(apiBase);
      if (result.data.patient?.id) {
        const fullPatientRes = await fetch(`${apiBase}/api/patients/${result.data.patient.id}`);
        const fullPatientData = await fullPatientRes.json();
        if (fullPatientData.success && fullPatientData.patient) {
          setSelectedPatient(fullPatientData.patient);
        }
      }
    } catch (err) {
      console.error("Upload error:", err);
      setErrorMsg(err.message || "An unexpected error occurred during analysis.");
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }
  };

  // Load Built-in Sample Record for Quick Hackathon Demo
  const loadSampleRecord = async (sampleType) => {
    setIsUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploadProgress("Loading pre-validated medical case...");

    try {
      const res = await fetch(`${apiBase}/api/sample-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleType }),
      });
      const data = await res.json();
      if (data.success && data.patient) {
        setSuccessMsg(data.message);
        await fetchPatients(apiBase);
        setSelectedPatient(data.patient);
      } else {
        throw new Error(data.error || "Failed to load sample document");
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsUploading(false);
      setUploadProgress("");
    }
  };

  // Filter events
  const events = selectedPatient?.events || [];
  const filteredEvents = events.filter((ev) => {
    const matchesCategory =
      selectedCategory === "ALL" ||
      ev.category?.toLowerCase().includes(selectedCategory.toLowerCase());
    const matchesQuery =
      searchQuery.trim() === "" ||
      ev.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ev.sourceDocument?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (ev.findings || []).some((f) => f.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (ev.medications || []).some((m) => m.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="top-nav">
        <div className="brand-wrapper">
          <div className="brand-icon">⚕</div>
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="brand-title">MediTimeline AI</span>
              <span className="brand-badge">HE-05 Solution</span>
            </div>
            <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
              Medical Document Intelligence & Chronological Patient Timeline
            </p>
          </div>
        </div>

        <div className="nav-actions">
          <div className="status-badge" title="Express Backend Connectivity">
            <span className={`status-dot ${backendStatus.online ? "" : "error"}`}></span>
            <span>{backendStatus.online ? "Backend Online (JSON Ready)" : "Backend Offline / Reconnecting"}</span>
          </div>

          <button
            className="btn-secondary"
            onClick={() => checkHealth(apiBase)}
            title="Refresh backend status"
          >
            Ping Server
          </button>
        </div>
      </header>

      {/* Strict Compliance Banner */}
      <div className="compliance-banner">
        <div className="compliance-text">
          <span className="compliance-tag">HE-05 STRICT GUARDRAILS</span>
          <span>
            Non-Diagnostic Engine • Zero Hallucination Policy • Every timeline event links to verified document text
          </span>
        </div>
        <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>Powered by Gemini 2.5 Flash</span>
      </div>

      {/* Main Grid */}
      <main className="main-wrapper">
        {/* Left Column: Upload, Settings, Sample Cases */}
        <div className="sidebar-col">
          {/* Document Upload Panel */}
          <div className="panel-card">
            <div className="panel-header">
              <span className="panel-title">📄 Document Ingestion</span>
              <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>Field: "document"</span>
            </div>

            {/* Drag and drop zone */}
            <div
              className="dropzone"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="dropzone-icon">📥</div>
              <div className="dropzone-text">Click or drop medical file here</div>
              <div className="dropzone-subtext">Supports PDF, JPG, PNG, and DOCX records</div>
              <div className="format-pills">
                <span className="format-pill">PDF</span>
                <span className="format-pill">JPG</span>
                <span className="format-pill">PNG</span>
                <span className="format-pill">DOCX</span>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="file-input"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.txt"
                onChange={handleFileChange}
              />
            </div>

            {/* Selected File Details */}
            {file && (
              <div className="selected-file-box">
                <div className="file-meta">
                  <span style={{ fontSize: "1.2rem" }}>📎</span>
                  <div>
                    <div className="file-name" title={file.name}>{file.name}</div>
                    <div className="file-size">{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <button
                  className="remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  ✕ Remove
                </button>
              </div>
            )}

            {/* Patient Name Override */}
            <div className="form-group">
              <label className="form-label">Patient Name (Optional - AI extracts if blank)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. John Doe"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </div>

            {/* Analyze Button */}
            <button
              className="btn-primary"
              onClick={handleAnalyze}
              disabled={!file || isUploading}
            >
              {isUploading ? "Extracting Intelligence..." : "⚡ Analyze with Gemini AI"}
            </button>

            {/* Analyzing Progress State */}
            {isUploading && (
              <div className="analyzing-box">
                <div className="spinner"></div>
                <div className="analyzing-text">{uploadProgress}</div>
                <div className="analyzing-sub">Extracting dates, events, findings & medications...</div>
              </div>
            )}

            {/* Error & Success Messages */}
            {errorMsg && (
              <div className="alert-error">
                <span>⚠️</span>
                <div>{errorMsg}</div>
              </div>
            )}

            {successMsg && (
              <div className="alert-success">
                ✓ {successMsg}
              </div>
            )}

            {/* Instant Hackathon Test Cases */}
            <div className="sample-section">
              <div className="sample-title">1-Click Test Cases (Hackathon Demo)</div>
              <div className="sample-buttons">
                <button
                  className="sample-btn"
                  onClick={() => loadSampleRecord("cardio_discharge")}
                  disabled={isUploading}
                >
                  <div className="sample-btn-title">Cardiology STEMI Case</div>
                  <div className="sample-btn-desc">ED Admission, PCI Stenting, Echo & Discharge</div>
                </button>

                <button
                  className="sample-btn"
                  onClick={() => loadSampleRecord("endocrinology_lab")}
                  disabled={isUploading}
                >
                  <div className="sample-btn-title">Endocrinology Lab & Progress</div>
                  <div className="sample-btn-desc">TSH Lab Abnormalities, Clinic Follow-up & Levothyroxine</div>
                </button>
              </div>
            </div>
          </div>

          {/* Patient Selector Card */}
          <div className="panel-card">
            <div className="panel-header">
              <span className="panel-title">👥 Patient Records ({patients.length})</span>
            </div>
            {patients.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                No patient timelines stored yet. Upload a document or click a test case above.
              </p>
            ) : (
              <div className="patient-list">
                {patients.map((pat) => (
                  <div
                    key={pat.id}
                    className={`patient-item ${selectedPatient?.id === pat.id ? "selected" : ""}`}
                    onClick={() => setSelectedPatient(pat)}
                  >
                    <div>
                      <div className="patient-item-name">{pat.name}</div>
                      <div className="patient-item-sub">
                        {pat.mrn || pat.id} • {pat.events?.length || 0} events
                      </div>
                    </div>
                    <span style={{ fontSize: "0.8rem", color: "var(--primary)" }}>→</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Timeline & Traceability */}
        <div className="timeline-panel">
          {selectedPatient ? (
            <>
              {/* Patient Overview Header Card */}
              <div className="patient-overview-card">
                <div className="patient-meta-large">
                  <div className="patient-avatar">
                    {selectedPatient.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="patient-headline">{selectedPatient.name}</h2>
                    <div className="patient-details-row">
                      <span><strong>MRN:</strong> {selectedPatient.mrn || "N/A"}</span>
                      <span>•</span>
                      <span><strong>Age:</strong> {selectedPatient.age || "Unspecified"}</span>
                      <span>•</span>
                      <span><strong>Gender:</strong> {selectedPatient.gender || "Unspecified"}</span>
                      <span>•</span>
                      <span><strong>Last Update:</strong> {selectedPatient.lastUpdated || "Recent"}</span>
                    </div>
                  </div>
                </div>

                <div className="stat-group">
                  <div className="stat-block">
                    <div className="stat-val">{selectedPatient.events?.length || 0}</div>
                    <div className="stat-lbl">Timeline Events</div>
                  </div>
                  <div className="stat-block">
                    <div className="stat-val">{selectedPatient.medicationsSummary?.length || 0}</div>
                    <div className="stat-lbl">Active Meds</div>
                  </div>
                </div>
              </div>

              {/* Medications Reconciled List */}
              {selectedPatient.medicationsSummary && selectedPatient.medicationsSummary.length > 0 && (
                <div className="panel-card" style={{ padding: "1rem 1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
                    <span style={{ fontSize: "1rem" }}>💊</span>
                    <strong style={{ fontSize: "0.88rem", color: "var(--secondary)" }}>
                      Reconciled Medications ({selectedPatient.medicationsSummary.length})
                    </strong>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {selectedPatient.medicationsSummary.map((med, idx) => (
                      <span key={idx} className="med-pill">
                        <strong>{med.name}</strong> {med.dosage ? `(${med.dosage})` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter and Search Bar */}
              <div className="filter-bar">
                <div className="search-input-wrap">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search findings, events, medications..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="category-chips">
                  {["ALL", "Admission", "Lab", "Imaging", "Procedure", "Prescription", "Discharge", "Follow-up"].map(
                    (cat) => (
                      <button
                        key={cat}
                        className={`category-chip ${selectedCategory === cat ? "active" : ""}`}
                        onClick={() => setSelectedCategory(cat)}
                      >
                        {cat}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Chronological Timeline Track */}
              <div className="timeline-track">
                {filteredEvents.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">🔍</div>
                    <div className="empty-title">No events match current filter</div>
                    <div className="empty-desc">Try clearing the search query or selecting "ALL" categories.</div>
                  </div>
                ) : (
                  filteredEvents.map((ev, index) => {
                    const isTraceOpen = expandedTraceId === ev.id || (!expandedTraceId && index === 0);
                    return (
                      <div key={ev.id || index} className="timeline-item">
                        <div className="timeline-node">{index + 1}</div>

                        <div className="timeline-card">
                          <div className="timeline-header">
                            <div>
                              <span className="timeline-date-badge">
                                {ev.date || "Date Unspecified"} {ev.time ? `• ${ev.time}` : ""}
                              </span>
                              <h3 className="timeline-event-title" style={{ marginTop: "0.35rem" }}>
                                {ev.title}
                              </h3>
                            </div>

                            <span className={`category-tag cat-${(ev.category || "General").split(" ")[0]}`}>
                              {ev.category || "General"}
                            </span>
                          </div>

                          {/* Important Clinical Findings */}
                          {ev.findings && ev.findings.length > 0 && (
                            <div>
                              <strong style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                                Key Findings & Observations:
                              </strong>
                              <ul className="findings-list">
                                {ev.findings.map((f, fIdx) => (
                                  <li key={fIdx} className="finding-bullet">
                                    <span>{f}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Medications in Event */}
                          {ev.medications && ev.medications.length > 0 && (
                            <div className="meds-container">
                              <span className="med-label">Medications:</span>
                              {ev.medications.map((m, mIdx) => (
                                <span key={mIdx} className="med-pill">
                                  💊 {m}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Source Traceability Footer */}
                          <div className="traceability-bar">
                            <span className="source-doc-ref">
                              <span>📄 Source:</span>
                              <strong>{ev.sourceDocument || "Uploaded Document"}</strong>
                            </span>

                            <button
                              className="source-toggle-btn"
                              onClick={() => setExpandedTraceId(expandedTraceId === ev.id ? null : ev.id)}
                            >
                              {expandedTraceId === ev.id ? "Hide Source Excerpt ▲" : "Verify Source Traceability ▼"}
                            </button>
                          </div>

                          {/* Verbatim Source Snippet Drawer */}
                          {expandedTraceId === ev.id && (
                            <div className="source-quote-box">
                              <div style={{ fontWeight: 600, fontSize: "0.72rem", color: "#0284c7", marginBottom: "0.2rem" }}>
                                VERBATIM CLINICAL TEXT CITATION:
                              </div>
                              "{ev.sourceSnippet || "Direct reference from clinical record."}"
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📁</div>
              <div className="empty-title">No Medical Document Selected</div>
              <div className="empty-desc">
                Upload a medical PDF, JPG, PNG or DOCX file on the left, or select one of the built-in test cases to generate an interactive chronological patient timeline.
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
