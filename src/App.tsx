/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Clock,
  Pill,
  ShieldCheck,
  Activity,
  ChevronDown,
  ChevronUp,
  Search,
  FileCheck,
  Stethoscope,
  Sparkles,
  RefreshCw,
  X,
} from "lucide-react";
import { PatientRecord, MedicalEvent, ExtractionResponse } from "./types.ts";

export default function App() {
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientRecord | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [patientNameInput, setPatientNameInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isBackendHealthy, setIsBackendHealthy] = useState<boolean | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchBackendHealth();
    loadPatients();
  }, []);

  const fetchBackendHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        setIsBackendHealthy(true);
      } else {
        setIsBackendHealthy(false);
      }
    } catch {
      setIsBackendHealthy(false);
    }
  };

  const loadPatients = async () => {
    try {
      const res = await fetch("/api/patients");
      const data = await res.json();
      if (data.success && Array.isArray(data.patients)) {
        setPatients(data.patients);
        if (data.patients.length > 0 && !selectedPatient) {
          setSelectedPatient(data.patients[0]);
        }
      }
    } catch (err) {
      console.warn("Could not load patients:", err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (selected: File) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const validExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx", ".txt"];
    const ext = selected.name.substring(selected.name.lastIndexOf(".")).toLowerCase();

    if (!validExtensions.includes(ext)) {
      setErrorMessage(`Unsupported format (${ext}). Supported: PDF, JPG, PNG, DOCX, TXT.`);
      return;
    }
    setFile(selected);
  };

  const handleUploadAndAnalyze = async () => {
    if (!file) {
      setErrorMessage("Please select or drop a medical document to analyze.");
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setStatusMessage("Streaming document to server...");

    try {
      const formData = new FormData();
      // Required field name: "document"
      formData.append("document", file);
      if (patientNameInput.trim()) {
        formData.append("patientName", patientNameInput.trim());
      }

      setStatusMessage("Gemini 2.5 Flash analyzing clinical events & verifying source traceability...");

      const response = await fetch("/api/analyze-file", {
        method: "POST",
        body: formData,
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const rawText = await response.text();
        throw new Error(
          `Server returned non-JSON response (HTTP ${response.status}). Preview: ${rawText.slice(0, 120)}`
        );
      }

      const result: ExtractionResponse = await response.json();

      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || "Document analysis failed.");
      }

      setSuccessMessage(
        `Successfully extracted ${result.data.events.length} timeline events for ${result.data.patient.name}.`
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Reload patient records and select the active one
      await loadPatients();
      const updatedRes = await fetch(`/api/patients/${result.data.patient.id}`);
      const updatedData = await updatedRes.json();
      if (updatedData.success && updatedData.patient) {
        setSelectedPatient(updatedData.patient);
      }
    } catch (err: any) {
      console.error("Analysis failure:", err);
      setErrorMessage(err.message || "Failed to analyze document.");
    } finally {
      setIsAnalyzing(false);
      setStatusMessage(null);
    }
  };

  const handleLoadSample = async (sampleType: "cardio_discharge" | "endocrinology_lab") => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setStatusMessage("Loading pre-validated medical case...");

    try {
      const res = await fetch("/api/sample-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleType }),
      });
      const data = await res.json();
      if (data.success && data.patient) {
        setSuccessMessage(data.message);
        await loadPatients();
        setSelectedPatient(data.patient);
      } else {
        throw new Error(data.error || "Failed to load sample document");
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsAnalyzing(false);
      setStatusMessage(null);
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

  const getCategoryColor = (category: string) => {
    const cat = (category || "").toLowerCase();
    if (cat.includes("admission")) return "bg-red-50 text-red-700 border-red-200";
    if (cat.includes("lab")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (cat.includes("imaging")) return "bg-amber-50 text-amber-700 border-amber-200";
    if (cat.includes("surgery") || cat.includes("procedure")) return "bg-purple-50 text-purple-700 border-purple-200";
    if (cat.includes("prescription")) return "bg-teal-50 text-teal-700 border-teal-200";
    if (cat.includes("discharge")) return "bg-pink-50 text-pink-700 border-pink-200";
    if (cat.includes("follow")) return "bg-sky-50 text-sky-700 border-sky-200";
    return "bg-slate-50 text-slate-700 border-slate-200";
  };

  return (
    <div id="meditimeline-app" className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Header */}
      <header id="main-header" className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-sky-500 text-white flex items-center justify-center shadow-md shadow-sky-500/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-slate-900">MediTimeline AI</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
                  HE-05 Solution
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Medical Document Intelligence & Patient Chronological Timeline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              id="backend-status-badge"
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 border border-slate-200 text-slate-700"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isBackendHealthy ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                }`}
              />
              <span>{isBackendHealthy ? "Backend Connected (JSON API)" : "Backend Checking..."}</span>
            </div>

            <button
              id="ping-server-btn"
              onClick={fetchBackendHealth}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Ping</span>
            </button>
          </div>
        </div>
      </header>

      {/* Compliance Notice Banner */}
      <div id="compliance-banner" className="bg-sky-50 border-b border-sky-200 px-4 sm:px-6 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-sky-900">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-sm bg-sky-200 text-sky-800 font-bold uppercase tracking-wider text-[10px]">
              HE-05 Guardrails
            </span>
            <span>
              <strong>Zero Diagnostic Inference:</strong> Factual document extraction only. All timeline events feature verbatim source traceability.
            </span>
          </div>
          <span className="text-sky-700 font-medium hidden sm:inline">Model: Gemini 2.5 Flash</span>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Upload, Controls & Patients (4 cols) */}
        <div className="lg:col-span-4 space-y-5">
          {/* Document Ingestion Box */}
          <div id="upload-panel" className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-600" />
                Medical Document Ingestion
              </h2>
              <span className="text-[11px] font-mono text-slate-500">POST /api/analyze-file</span>
            </div>

            {/* Dropzone */}
            <div
              id="file-dropzone"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-sky-500 rounded-xl p-6 text-center bg-slate-50 hover:bg-sky-50/50 cursor-pointer transition flex flex-col items-center justify-center gap-2"
            >
              <div className="w-12 h-12 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center mb-1">
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800">
                Click or drag medical document
              </p>
              <p className="text-xs text-slate-500">
                Accepts PDF, JPG, PNG, DOCX, or TXT
              </p>
              <div className="flex gap-1.5 mt-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-slate-200 text-slate-700">PDF</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-slate-200 text-slate-700">JPG</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-slate-200 text-slate-700">PNG</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-slate-200 text-slate-700">DOCX</span>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.txt"
                onChange={handleFileInputChange}
              />
            </div>

            {/* Selected File Card */}
            {file && (
              <div id="selected-file-display" className="mt-3 p-3 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <FileCheck className="w-5 h-5 text-sky-600 shrink-0" />
                  <div className="truncate">
                    <p className="text-xs font-semibold text-slate-900 truncate" title={file.name}>{file.name}</p>
                    <p className="text-[11px] text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="p-1 text-slate-400 hover:text-red-600 rounded-md transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Optional Patient Name */}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Patient Name (Optional)
              </label>
              <input
                type="text"
                className="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg outline-hidden focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="Auto-detected if left empty"
                value={patientNameInput}
                onChange={(e) => setPatientNameInput(e.target.value)}
              />
            </div>

            {/* Action Button */}
            <button
              id="analyze-document-btn"
              onClick={handleUploadAndAnalyze}
              disabled={!file || isAnalyzing}
              className="mt-4 w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition shadow-sm shadow-sky-600/20 flex items-center justify-center gap-2"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing with Gemini...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Analyze & Build Timeline</span>
                </>
              )}
            </button>

            {/* Progress Status */}
            {isAnalyzing && (
              <div className="mt-3 p-3 bg-sky-50 border border-sky-100 rounded-lg text-center">
                <p className="text-xs font-semibold text-sky-800">{statusMessage}</p>
                <p className="text-[11px] text-sky-600 mt-0.5">Extracting findings, medications, and timestamps</p>
              </div>
            )}

            {/* Messages */}
            {errorMessage && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <div>{errorMessage}</div>
              </div>
            )}

            {successMessage && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                <div>{successMessage}</div>
              </div>
            )}

            {/* 1-Click Demo Test Cases */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2.5">
                Hackathon 1-Click Demo Records
              </span>
              <div className="space-y-2">
                <button
                  id="sample-cardio-btn"
                  onClick={() => handleLoadSample("cardio_discharge")}
                  disabled={isAnalyzing}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-sky-300 bg-slate-50 hover:bg-sky-50/50 transition group"
                >
                  <div className="text-xs font-semibold text-slate-800 group-hover:text-sky-700">
                    Cardiology STEMI Discharge Case
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Emergency Admission, PCI Stenting, Echo & Discharge Summary
                  </div>
                </button>

                <button
                  id="sample-endo-btn"
                  onClick={() => handleLoadSample("endocrinology_lab")}
                  disabled={isAnalyzing}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-sky-300 bg-slate-50 hover:bg-sky-50/50 transition group"
                >
                  <div className="text-xs font-semibold text-slate-800 group-hover:text-sky-700">
                    Endocrinology Lab & Outpatient Note
                  </div>
                  <div className="text-[11px] text-slate-500">
                    TSH/Thyroid panel, Consultation, and Levothyroxine initiation
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Stored Patient Records */}
          <div id="patient-records-panel" className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center justify-between">
              <span>Patient Directory ({patients.length})</span>
              <span className="text-[11px] font-normal text-slate-500">JSON Storage</span>
            </h3>

            {patients.length === 0 ? (
              <p className="text-xs text-slate-500">No patient records saved yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {patients.map((pat) => (
                  <button
                    key={pat.id}
                    onClick={() => setSelectedPatient(pat)}
                    className={`w-full text-left p-2.5 rounded-lg border transition flex items-center justify-between ${
                      selectedPatient?.id === pat.id
                        ? "border-sky-500 bg-sky-50/70"
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900">{pat.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {pat.mrn || pat.id} • {pat.events?.length || 0} events
                      </div>
                    </div>
                    <span className="text-xs text-sky-600 font-semibold">View →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Patient Intelligence & Chronological Timeline (8 cols) */}
        <div className="lg:col-span-8 space-y-5">
          {selectedPatient ? (
            <>
              {/* Patient Banner Card */}
              <div id="patient-card" className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-sky-600 to-sky-400 text-white flex items-center justify-center text-lg font-bold">
                    {selectedPatient.name.charAt(0)}
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                      {selectedPatient.name}
                    </h1>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span><strong>MRN:</strong> {selectedPatient.mrn || "N/A"}</span>
                      <span>•</span>
                      <span><strong>Age:</strong> {selectedPatient.age || "Unspecified"}</span>
                      <span>•</span>
                      <span><strong>Gender:</strong> {selectedPatient.gender || "Unspecified"}</span>
                      <span>•</span>
                      <span><strong>Updated:</strong> {selectedPatient.lastUpdated || "Recent"}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 sm:gap-6 border-t sm:border-t-0 pt-3 sm:pt-0 w-full sm:w-auto justify-around sm:justify-end">
                  <div className="text-center sm:text-right">
                    <span className="text-xl font-extrabold text-sky-600 block">
                      {selectedPatient.events?.length || 0}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Events
                    </span>
                  </div>
                  <div className="text-center sm:text-right">
                    <span className="text-xl font-extrabold text-teal-600 block">
                      {selectedPatient.medicationsSummary?.length || 0}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Active Meds
                    </span>
                  </div>
                </div>
              </div>

              {/* Reconciled Medications Banner */}
              {selectedPatient.medicationsSummary && selectedPatient.medicationsSummary.length > 0 && (
                <div id="medications-reconciliation" className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
                    <Pill className="w-4 h-4 text-emerald-600" />
                    <span>Reconciled Medications ({selectedPatient.medicationsSummary.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedPatient.medicationsSummary.map((med, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <strong>{med.name}</strong>
                        {med.dosage && <span className="opacity-80">({med.dosage})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter and Search Controls */}
              <div id="timeline-filters" className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search findings, procedures, medications..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-hidden focus:bg-white focus:border-sky-500"
                  />
                </div>

                <div className="flex flex-wrap gap-1">
                  {[
                    "ALL",
                    "Admission",
                    "Lab",
                    "Imaging",
                    "Procedure",
                    "Prescription",
                    "Discharge",
                    "Follow-up",
                  ].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition ${
                        selectedCategory === cat
                          ? "bg-sky-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chronological Timeline Stream */}
              <div id="chronological-timeline" className="relative pl-7 space-y-5 before:content-[''] before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                {filteredEvents.length === 0 ? (
                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-8 text-center">
                    <p className="text-sm font-semibold text-slate-700">No events matched your search or filter.</p>
                    <p className="text-xs text-slate-400 mt-1">Try resetting the category filter to ALL.</p>
                  </div>
                ) : (
                  filteredEvents.map((ev, index) => {
                    const isTraceExpanded = expandedTraceId === ev.id || (!expandedTraceId && index === 0);

                    return (
                      <div key={ev.id || index} className="relative group">
                        {/* Timeline Node Icon */}
                        <div className="absolute -left-7 top-4 w-6 h-6 rounded-full bg-white border-2 border-sky-600 flex items-center justify-center text-[10px] font-bold text-sky-700 shadow-xs z-10">
                          {index + 1}
                        </div>

                        {/* Event Card */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:shadow-md transition">
                          {/* Header */}
                          <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-100">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-sky-800 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                                  {ev.date || "Date Unspecified"} {ev.time ? `• ${ev.time}` : ""}
                                </span>
                              </div>
                              <h3 className="text-base font-bold text-slate-900 mt-1.5">
                                {ev.title}
                              </h3>
                            </div>

                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wide ${getCategoryColor(
                                ev.category
                              )}`}
                            >
                              {ev.category || "General"}
                            </span>
                          </div>

                          {/* Important Clinical Findings */}
                          {ev.findings && ev.findings.length > 0 && (
                            <div className="mt-3.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                                Key Clinical Findings & Measurements
                              </span>
                              <ul className="space-y-1">
                                {ev.findings.map((finding, fIdx) => (
                                  <li key={fIdx} className="text-xs text-slate-700 flex items-start gap-2 leading-relaxed">
                                    <span className="text-sky-600 font-bold">•</span>
                                    <span>{finding}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Medications in this Event */}
                          {ev.medications && ev.medications.length > 0 && (
                            <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Medications:
                              </span>
                              {ev.medications.map((m, mIdx) => (
                                <span
                                  key={mIdx}
                                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200"
                                >
                                  <Pill className="w-3 h-3 text-emerald-600" />
                                  <span>{m}</span>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Source Traceability Footer */}
                          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5 text-slate-500">
                              <FileText className="w-3.5 h-3.5 text-sky-600" />
                              <span>Source Document:</span>
                              <strong className="text-slate-700">{ev.sourceDocument || "Clinical Record"}</strong>
                            </div>

                            <button
                              onClick={() => setExpandedTraceId(expandedTraceId === ev.id ? null : ev.id)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:text-sky-800 px-2 py-1 rounded-md hover:bg-sky-50 transition"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>{expandedTraceId === ev.id ? "Hide Source Excerpt" : "Verify Source Traceability"}</span>
                              {expandedTraceId === ev.id ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          {/* Verbatim Source Snippet Quote */}
                          {isTraceExpanded && (
                            <div className="mt-3 p-3 bg-slate-50 rounded-lg border-l-4 border-sky-600 text-xs text-slate-800 font-mono leading-relaxed">
                              <div className="text-[10px] font-bold text-sky-700 tracking-wider mb-1">
                                VERBATIM EXCERPT CITATION:
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
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs">
              <Stethoscope className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h2 className="text-base font-bold text-slate-800">No Patient Timeline Selected</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                Upload a medical PDF, JPG, PNG, or DOCX document on the left, or test using the sample cases to generate an interactive chronological patient timeline.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
