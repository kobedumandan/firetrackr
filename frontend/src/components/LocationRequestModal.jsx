import { useState, useEffect, useRef } from "react";
import AppModal from "./AppModal";
import { sendReporterSms } from "../api";
import { IntakeSection, IntakeDisclosure } from "./IncidentIntakeSection";
import { ICON_COPY, ICON_CHECK, ICON_SEND, ICON_LINK, ICON_PIN } from "./incidentFormOptions";
import { Icon, Field } from "./incidentForm";
import "../styles/LocationRequestModal.css";

// The reporter page is served by the API, including when it is hosted separately.
const PUBLIC_BASE_URL =
  (import.meta.env.VITE_PUBLIC_BASE_URL?.trim() || import.meta.env.VITE_API_BASE_URL?.trim() || window.location.origin).replace(/\/+$/, "");

function generateToken() {
  return `RPT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const previous = document.activeElement;
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    try {
      if (!document.execCommand("copy")) throw new Error("Copy failed");
    } finally {
      field.remove();
      if (previous?.isConnected) previous.focus();
    }
  }
}

function CopyButton({ text, label = "Copy", onError }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    onError(null);
    clearTimeout(resetTimer.current);
    setCopied(false);
    try {
      await copyText(text);
      setCopied(true);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("Couldn't copy. Select the link or message and copy it manually.");
    }
  }

  return (
    <button type="button" className={`lrm-btn ${copied ? "done" : ""}`} onClick={copy}>
      <Icon d={copied ? ICON_CHECK : ICON_COPY} />
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

/**
 * onLogIncident(coords, mobile, token) opens incident intake at the received pin.
 * Parent owns the existing reporter-session and WebSocket lifecycle.
 */
export default function LocationRequestModal({
  onClose,
  onLocationReceived,
  onTokenGenerated,
  onLogIncident,
  receivedData,
}) {
  const [token] = useState(generateToken);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);
  const [copyError, setCopyError] = useState(null);
  const [serverLink, setServerLink] = useState(null);
  const submitting = useRef(false);
  const completedAction = useRef(null);

  const received = !!receivedData;
  const reporterPhone = receivedData?.phone || phone.trim();
  const reportUrl = serverLink || `${PUBLIC_BASE_URL}/report/${token}`;
  const smsText = `BFP FireTrackr: Please share your location to help emergency responders reach you. Tap: ${reportUrl}`;

  async function handleSendSms(e) {
    e.preventDefault();
    if (!phone.trim() || submitting.current) return;
    submitting.current = true;
    setSending(true);
    setSendStatus(null);
    try {
      const result = await sendReporterSms(token, phone.trim());
      if (result.link) setServerLink(result.link);
      setSendStatus(
        result.sms_sent
          ? { ok: true, msg: `Sent to ${result.phone_number}. Waiting for them to share their location.` }
          : { ok: false, msg: "SMS is turned off. Copy the link or message and share it manually." }
      );
    } catch (error) {
      setSendStatus({ ok: false, msg: error.message || "Couldn't send the SMS. Try again or share the link manually." });
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  useEffect(() => {
    onTokenGenerated?.(token);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!receivedData) return;
    onLocationReceived?.({ token, coords: [receivedData.lat, receivedData.lng] });
  }, [receivedData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (received && !sending) completedAction.current?.focus();
  }, [received, sending]);

  return (
    <AppModal
      eyebrow="REPORTER LINK"
      title={received ? "Reporter location received" : "Request the reporter's location"}
      subtitle={received ? "Use the shared pin to start an incident report." : "Send a link so the reporter can share their GPS pin."}
      onClose={onClose}
      width={640}
      className="eim-panel intake-panel lrm-panel"
      dismissible={!sending}
      manageFocus
    >
      <div className="eim-body intake-scroll lrm-body">
        <div className={`lrm-status ${received ? "received" : "awaiting"}`} role="status" aria-live="polite">
          <span className="lrm-status-icon">
            {received ? <Icon d={ICON_CHECK} /> : <span className="lrm-pulse" />}
          </span>
          <span className="lrm-status-text">
            <span className="lrm-status-title">{received ? "Location received" : "Waiting for location"}</span>
            <span className="lrm-status-desc">
              {received
                ? "The reporter's pin is now visible on the map."
                : "The pin appears when the reporter opens the link and allows location access."}
            </span>
          </span>
        </div>

        {received ? (
          <IntakeSection icon={ICON_PIN} title="Reporter location" desc="Ready to log an incident">
            <div className="lrm-coordinates">
              <div><span className="lrm-coordinate-label">Latitude</span><span className="lrm-coordinate-value">{Number(receivedData.lat).toFixed(6)}</span></div>
              <div><span className="lrm-coordinate-label">Longitude</span><span className="lrm-coordinate-value">{Number(receivedData.lng).toFixed(6)}</span></div>
            </div>
            {reporterPhone && <div className="lrm-contact"><span>Reporter mobile number</span><strong>{reporterPhone}</strong></div>}
          </IntakeSection>
        ) : (
          <>
            <IntakeSection icon={ICON_SEND} title="Send by SMS" desc="Send the link directly">
              <form onSubmit={handleSendSms} aria-busy={sending}>
                <Field label="Reporter mobile number">
                  <div className="lrm-send">
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="e.g. 09XX XXX XXXX"
                      value={phone}
                      onChange={e => { setPhone(e.target.value); setSendStatus(null); }}
                      aria-label="Reporter mobile number"
                      disabled={sending}
                      data-autofocus
                    />
                    <button type="submit" className="apm-btn-submit lrm-send-btn" disabled={sending || !phone.trim()}>
                      {sending ? <><span className="apm-spinner" /> Sending…</> : <><Icon d={ICON_SEND} /> Send link</>}
                    </button>
                  </div>
                </Field>
              </form>
              {sendStatus && (
                <div className={`lrm-send-status ${sendStatus.ok ? "ok" : "err"}`} role={sendStatus.ok ? "status" : "alert"}>
                  {sendStatus.ok && <Icon d={ICON_CHECK} />}
                  <span>{sendStatus.msg}</span>
                </div>
              )}
            </IntakeSection>

            <IntakeSection icon={ICON_LINK} title="Share manually" desc="Copy the link for any chat app">
              <Field label="Reporter link">
                <div className="lrm-link">
                  <Icon d={ICON_LINK} />
                  <input type="text" readOnly value={reportUrl} aria-label="Reporter link" onFocus={e => e.target.select()} />
                  <CopyButton text={reportUrl} label="Copy link" onError={setCopyError} />
                </div>
              </Field>
              <div className="lrm-message-preview">
                <IntakeDisclosure title="Message preview" summary="Copy a ready-to-send message">
                  <div className="lrm-message">
                    <p>{smsText}</p>
                    <CopyButton text={smsText} label="Copy message" onError={setCopyError} />
                  </div>
                </IntakeDisclosure>
              </div>
            </IntakeSection>
          </>
        )}
      </div>

      {copyError && <div className="apm-error intake-error" role="alert">{copyError}</div>}

      <div className="eim-footer">
        <span className="lrm-session">Reference <span className="lrm-session-code">{token}</span></span>
        <div className="eim-footer-actions">
          <button type="button" ref={received && !onLogIncident ? completedAction : undefined} className="apm-btn-cancel" onClick={onClose} disabled={sending}>{received && !onLogIncident ? "Done" : "Close"}</button>
          {received && onLogIncident && (
            <button type="button" ref={completedAction} className="apm-btn-submit" disabled={sending} onClick={() => onLogIncident([receivedData.lat, receivedData.lng], reporterPhone, token)}>
              <Icon d={ICON_PIN} /> Log incident here
            </button>
          )}
        </div>
      </div>
    </AppModal>
  );
}
