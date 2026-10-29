import { lazy, Suspense, useState, useRef, useEffect } from "react";
import "../styles/SettingsPage.css";
import { useSessionTimer } from "../hooks/useSessionTimer";
import SignOutModal from "../components/SignOutModal";
import SettingsLoading from "../components/SettingsLoading";
import {
  changePassword,
  fetchCurrentUser,
  fetchLoginHistory,
  updateAccountProfile,
} from "../api";
import { describeUserAgent, formatLoginStamp } from "../utils/session";
const ModelSettings = lazy(() => import("../components/ModelSettings"));

function IcoAccount({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="M200-246q54-53 125.5-83.5T480-360q83 0 154.5 30.5T760-246v-514H200v514Zm379-235q41-41 41-99t-41-99q-41-41-99-41t-99 41q-41 41-41 99t41 99q41 41 99 41t99-41ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm69-80h422q-44-39-99.5-59.5T480-280q-56 0-112.5 20.5T269-200Zm168.5-337.5Q420-555 420-580t17.5-42.5Q455-640 480-640t42.5 17.5Q540-605 540-580t-17.5 42.5Q505-520 480-520t-42.5-17.5ZM480-503Z" />
    </svg>
  );
}

function IcoSecurity({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z" />
    </svg>
  );
}

function IcoSession({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="M360-840v-80h240v80H360Zm80 440h80v-240h-80v240Zm-99.5 291.5Q275-137 226-186t-77.5-114.5Q120-366 120-440t28.5-139.5Q177-645 226-694t114.5-77.5Q406-800 480-800q62 0 119 20t107 58l56-56 56 56-56 56q38 50 58 107t20 119q0 74-28.5 139.5T734-186q-49 49-114.5 77.5T480-80q-74 0-139.5-28.5ZM678-242q82-82 82-198t-82-198q-82-82-198-82t-198 82q-82 82-82 198t82 198q82 82 198 82t198-82ZM480-440Z" />
    </svg>
  );
}

function IcoAppearance({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 32.5-156t88-127Q256-817 330-848.5T488-880q80 0 151 27.5t124.5 76q53.5 48.5 85 115T880-518q0 115-70 176.5T640-280h-74q-9 0-12.5 5t-3.5 11q0 12 15 34.5t15 51.5q0 50-27.5 74T480-80Zm0-400Zm-177 23q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120-160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm200 0q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120 160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17ZM480-160q9 0 14.5-5t5.5-13q0-14-15-33t-15-57q0-42 29-67t71-25h70q66 0 113-38.5T800-518q0-121-92.5-201.5T488-800q-136 0-232 93t-96 227q0 133 93.5 226.5T480-160Z" />
    </svg>
  );
}

function IcoNotifications({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z" />
    </svg>
  );
}

function IcoMapDisplay({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="m600-120-240-84-186 72q-20 8-37-4.5T120-170v-560q0-13 7.5-23t20.5-15l212-72 240 84 186-72q20-8 37 4.5t17 33.5v560q0 13-7.5 23T812-192l-212 72Zm-40-98v-468l-160-56v468l160 56Zm80 0 120-40v-474l-120 46v468Zm-440-10 120-46v-468l-120 40v474Zm440-458v468-468Zm-320-56v468-468Z" />
    </svg>
  );
}

function IcoAbout({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="M440-280h80v-240h-80v240Zm68.5-331.5Q520-623 520-640t-11.5-28.5Q497-680 480-680t-28.5 11.5Q440-657 440-640t11.5 28.5Q463-600 480-600t28.5-11.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
    </svg>
  );
}

const SIDEBAR_ITEMS = [
  {
    section: "account",
    label: "Account",
    items: [
      { id: "profile", Icon: IcoAccount, label: "Profile" },
      { id: "security", Icon: IcoSecurity, label: "Security" },
      { id: "session", Icon: IcoSession, label: "Session" },
    ],
  },
  {
    section: "preferences",
    label: "Preferences",
    items: [
      { id: "appearance", Icon: IcoAppearance, label: "Appearance" },
      { id: "notifications", Icon: IcoNotifications, label: "Notifications" },
      { id: "display", Icon: IcoMapDisplay, label: "Map Display" },
    ],
  },
  {
    section: "system",
    label: "System",
    items: [
      { id: "model", Icon: IcoMapDisplay, label: "Model", adminOnly: true },
      { id: "about", Icon: IcoAbout, label: "About" },
    ],
  },
];

// Matches the backend's PasswordChange floor; keep the two in step.
const MIN_PASSWORD_LENGTH = 8;
const LOGIN_HISTORY_LIMIT = 5;

/**
 * Pass `on` and `onChange` to drive the switch from outside — that's the form
 * used by anything whose state has somewhere real to live. Omit them and it
 * falls back to local state.
 */
function SettingsHeading({ title, children }) {
  return (
    <header className="settings-page-heading">
      <h2 className="settings-section-title">{title}</h2>
      <p className="section-desc">{children}</p>
    </header>
  );
}

function SettingsBlockHeading({ Icon, title, children }) {
  return (
    <div className="block-header">
      <span className="settings-card-icon" aria-hidden="true"><Icon /></span>
      <div>
        <h3 className="block-title">{title}</h3>
        <p className="block-description">{children}</p>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, defaultOn = false, label }) {
  const [localOn, setLocalOn] = useState(defaultOn);
  const controlled = on !== undefined;
  const value = controlled ? on : localOn;

  function toggle() {
    if (controlled) onChange(!value);
    else setLocalOn((v) => !v);
  }

  return (
    <div className="toggle-wrap">
      <button
        type="button"
        className={`toggle${value ? " on" : ""}`}
        onClick={toggle}
        role="switch"
        aria-checked={value}
        aria-label={label}
      >
        <div className="toggle-knob" />
      </button>
      <span className="toggle-label">{value ? "ON" : "OFF"}</span>
    </div>
  );
}

/**
 * An inline-editable row. Pass `onSave` to persist the value server-side: it is
 * awaited, and the row stays open showing the error if it rejects, so a failed
 * save can never look like a successful one. Without `onSave` the edit is local
 * only, which is the historical behaviour of the un-wired Profile rows.
 */
function EditableRow({ label, sub, value: initialValue, onSave, type = "text" }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  // The parent re-renders with the saved profile, so follow the prop when it
  // changes underneath us. Adjusted during render rather than in an effect —
  // an effect here would paint the stale value for a frame first.
  const [lastProp, setLastProp] = useState(initialValue);
  if (initialValue !== lastProp) {
    setLastProp(initialValue);
    setValue(initialValue);
  }

  function startEdit() {
    setDraft(value === "—" ? "" : value);
    setError(null);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    const next = draft.trim();
    if (!next || next === value) {
      cancel();
      return;
    }
    if (!onSave) {
      setValue(next);
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setValue(next);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="block-row">
      <div className="row-left">
        <div className="row-label">{label}</div>
        <div className={`row-sub${error ? " row-sub-error" : ""}`}>
          {error || sub}
        </div>
      </div>
      <div className="row-right">
        {editing ? (
          <>
            <input
              ref={inputRef}
              className="inline-input"
              type={type}
              aria-label={label}
              value={draft}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
            />
            <button className="btn-save" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-edit" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="row-value">{value}</span>
            <button className="btn-edit" onClick={startEdit}>
              Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── SECTIONS ─────────────────────────────────────────────────────────────────

function SectionProfile({ user, onAccountUpdate = () => {} }) {
  const firstName = user?.first_name ?? "";
  const lastName = user?.last_name ?? "";
  const initials = `${firstName[0] ?? "?"}${lastName[0] ?? ""}`.toUpperCase();
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || "—";
  const email = user?.email ?? "—";
  const contact = user?.contact ?? "—";
  const role = user?.role ?? "—";
  const designation =
    user?.designation ?? (role === "admin" ? "Administrator" : "—");
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  // Admins aren't station-bound, so an absent station is expected for them and
  // a genuine gap for a responder — say which, rather than printing "—".
  const station = user?.station?.station_name
    ? user.station.station_name
    : role === "admin"
      ? "City-wide — all stations"
      : "Not assigned";

  const saveField = (field) => async (value) =>
    onAccountUpdate(await updateAccountProfile({ [field]: value }));

  return (
    <>
      <SettingsHeading title="Profile">
        Your account information and identity details.
      </SettingsHeading>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoAccount} title="Identity">Your personal details and contact information.</SettingsBlockHeading>
        <div className="avatar-block">
          <div className="big-avatar">
            {initials}
            <div className="avatar-online" />
          </div>
          <div className="name-wrapper">
            <div className="avatar-name">{fullName}</div>
            <div className="avatar-email">{email}</div>
            <span className="val-badge vb-fire">{role}</span>
          </div>
        </div>
        <EditableRow
          label="First Name"
          sub="Your given name on record"
          value={firstName || "—"}
          onSave={saveField("first_name")}
        />
        <EditableRow
          label="Last Name"
          sub="Your surname on record"
          value={lastName || "—"}
          onSave={saveField("last_name")}
        />
        <EditableRow
          label="Contact Number"
          sub="Primary contact for dispatch"
          value={contact}
          onSave={saveField("contact")}
        />
      </div>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoSecurity} title="Role &amp; Access">Your assigned role and station access.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">User Role</div>
            <div className="row-sub">Assigned system access level</div>
          </div>
          <div className="row-right">
            <span className="val-badge vb-fire">{role}</span>
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Designation</div>
            <div className="row-sub">Position within the command structure</div>
          </div>
          <div className="row-right">
            <span className="row-value">{designation}</span>
          </div>
        </div>
        {/* Rank only exists on personnel records, so it would read "—" forever
            on an admin account. Omit the row instead of showing an empty one. */}
        {user?.rank && (
          <div className="block-row">
            <div className="row-left">
              <div className="row-label">Rank</div>
              <div className="row-sub">Service rank on record</div>
            </div>
            <div className="row-right">
              <span className="row-value">{user.rank}</span>
            </div>
          </div>
        )}
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Assigned Station</div>
            <div className="row-sub">Primary reporting station</div>
          </div>
          <div className="row-right">
            <span className="row-value">{station}</span>
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Account Created</div>
            <div className="row-sub">Date this account was provisioned</div>
          </div>
          <div className="row-right">
            <span className="row-value">{createdAt}</span>
          </div>
        </div>
      </div>
    </>
  );
}

/** Rows revealed under Password when "Change" is pressed — kept on the page
 *  rather than in a modal so the surrounding credentials stay visible. */
function PasswordChangeRows({ onDone, onCancel }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const firstRef = useRef();

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready =
    current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && next === confirm;

  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      onDone(await changePassword(current, next));
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") onCancel();
  }

  const fields = [
    {
      key: "current",
      label: "Current Password",
      sub: "Confirms it is really you making the change",
      value: current,
      set: setCurrent,
      inputRef: firstRef,
    },
    {
      key: "next",
      label: "New Password",
      sub: `At least ${MIN_PASSWORD_LENGTH} characters`,
      value: next,
      set: setNext,
    },
    {
      key: "confirm",
      label: "Confirm New Password",
      sub: mismatch ? "Passwords do not match" : "Re-enter the new password",
      value: confirm,
      set: setConfirm,
      invalid: mismatch,
    },
  ];

  return (
    <>
      {fields.map((f) => (
        <div className="block-row pw-row" key={f.key}>
          <div className="row-left">
            <div className="row-label">{f.label}</div>
            <div className={`row-sub${f.invalid ? " row-sub-error" : ""}`}>
              {f.sub}
            </div>
          </div>
          <div className="row-right">
            <input
              ref={f.inputRef}
              className={`inline-input${f.invalid ? " input-invalid" : ""}`}
              type="password"
              aria-label={f.label}
              autoComplete={
                f.key === "current" ? "current-password" : "new-password"
              }
              value={f.value}
              disabled={saving}
              onChange={(e) => f.set(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
        </div>
      ))}
      <div className="block-row pw-row pw-actions">
        <div className="row-left">
          {error ? (
            <div className="row-sub row-sub-error">{error}</div>
          ) : (
            <div className="row-sub">
              All other sessions are signed out when the password changes.
            </div>
          )}
        </div>
        <div className="row-right">
          <button className="btn-edit" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-save"
            onClick={submit}
            disabled={!ready || saving}
          >
            {saving ? "Updating…" : "Update Password"}
          </button>
        </div>
      </div>
    </>
  );
}

function LoginHistoryBlock() {
  const [rows, setRows] = useState(null); // null = still loading
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchLoginHistory(LOGIN_HISTORY_LIMIT)
      .then((data) => alive && setRows(data))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const pending = rows === null && !error;
  const latest = rows?.[0] ?? null;
  const earlier = rows?.slice(1) ?? [];

  // Failed or empty history stays distinct from a recorded sign-in.
  function cell(render) {
    if (error || !latest) return "—";
    return render(latest);
  }

  return (
    <div className="settings-block" aria-busy={pending}>
      <SettingsBlockHeading Icon={IcoSession} title="Login History">Recent successful sign-ins to your account.</SettingsBlockHeading>
      {pending ? (
        <SettingsLoading message="Loading login history…" compact />
      ) : (
        <>
          <div className="block-row">
            <div className="row-left">
              <div className="row-label">Last Login</div>
              <div className={`row-sub${error ? " row-sub-error" : ""}`}>
                {error || "Most recent successful authentication"}
              </div>
            </div>
            <div className="row-right">
              <span className="row-value highlight">
                {cell((r) => formatLoginStamp(r.logged_in_at))}
              </span>
            </div>
          </div>
          <div className="block-row">
            <div className="row-left">
              <div className="row-label">Login Device</div>
              <div className="row-sub">Browser and operating system</div>
            </div>
            <div className="row-right">
              <span className="row-value">
                {cell((r) => describeUserAgent(r.user_agent))}
              </span>
            </div>
          </div>
          <div className="block-row">
            <div className="row-left">
              <div className="row-label">IP Address</div>
              <div className="row-sub">Network address at time of login</div>
            </div>
            <div className="row-right">
              <span className="row-value">{cell((r) => r.ip_address ?? "—")}</span>
            </div>
          </div>

          {earlier.length > 0 && (
            <>
              <div className="block-subhead">Earlier Sign-ins</div>
              {earlier.map((r) => (
                <div className="block-row history-row" key={r.login_id}>
                  <div className="row-left">
                    <div className="row-label">
                      {formatLoginStamp(r.logged_in_at)}
                    </div>
                    <div className="row-sub">{describeUserAgent(r.user_agent)}</div>
                  </div>
                  <div className="row-right">
                    <span className="row-value">{r.ip_address ?? "—"}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** "Last changed 45 days ago", from the real timestamp. */
function passwordAgeLabel(user) {
  const changed = user?.password_changed_at;
  if (!changed) return "Not changed since this account was created";
  const then = new Date(changed);
  if (Number.isNaN(then.getTime())) return "Last changed at an unknown time";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Last changed today";
  if (days === 1) return "Last changed yesterday";
  return `Last changed ${days} days ago`;
}

function SectionSecurity({ user, onAccountUpdate = () => {} }) {
  const [changingPassword, setChangingPassword] = useState(false);
  const [notice, setNotice] = useState(null);

  return (
    <>
      <SettingsHeading title="Security">
        Manage your password and login credentials.
      </SettingsHeading>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoSecurity} title="Credentials">Keep your sign-in details up to date.</SettingsBlockHeading>
        <EditableRow
          label="Email Address"
          sub="Used for system login and alerts"
          value={user?.email ?? "—"}
          onSave={async (email) => {
            onAccountUpdate(await updateAccountProfile({ email }));
            setNotice("Email address updated. Other sessions were signed out.");
          }}
        />
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Password</div>
            <div className="row-sub">{passwordAgeLabel(user)}</div>
          </div>
          <div className="row-right">
            {!changingPassword && <span className="row-value">••••••••••••</span>}
            <button
              className="btn-edit"
              onClick={() => {
                setNotice(null);
                setChangingPassword((v) => !v);
              }}
            >
              {changingPassword ? "Close" : "Change"}
            </button>
          </div>
        </div>
        {changingPassword && (
          <PasswordChangeRows
            onCancel={() => setChangingPassword(false)}
            onDone={(res) => {
              setChangingPassword(false);
              setNotice("Password updated. Other sessions were signed out.");
              onAccountUpdate(res);
            }}
          />
        )}
        {notice && (
          <div className="block-row">
            <div className="row-left">
              <div className="row-sub row-sub-ok">{notice}</div>
            </div>
          </div>
        )}
      </div>

      <LoginHistoryBlock />
    </>
  );
}

function SectionSession({ onLogout }) {
  const { timer, signedInAt, expiry, lifetimeHours, expired } =
    useSessionTimer();

  return (
    <>
      <SettingsHeading title="Session">
        Current login session details and activity.
      </SettingsHeading>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoSession} title="Active Session">Your current session and its expiration.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Session Status</div>
            <div className="row-sub">Current authentication state</div>
          </div>
          <div className="row-right">
            <span className={`val-badge ${expired ? "vb-red" : "vb-green"}`}>
              {expired ? "Expired" : "Active"}
            </span>
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Session Duration</div>
            <div className="row-sub">Time elapsed since login</div>
          </div>
          <div className="row-right">
            <div className="session-timer">
              <div className="timer-dot" />
              <span>{timer}</span>
            </div>
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Signed In</div>
            <div className="row-sub">When this session started</div>
          </div>
          <div className="row-right">
            <span className="row-value">{signedInAt}</span>
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Session Expires</div>
            <div className="row-sub">
              {lifetimeHours
                ? `Auto-logout ${lifetimeHours} hours after sign-in`
                : "Auto-logout when the access token expires"}
            </div>
          </div>
          <div className="row-right">
            <span className="row-value">{expiry}</span>
          </div>
        </div>
      </div>

      <div className="danger-block">
        <SettingsBlockHeading Icon={IcoSession} title="End Session">Sign out when you have finished using the dashboard.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Sign Out</div>
            <div className="row-sub">
              Terminate this session and return to login
            </div>
          </div>
          <div className="row-right">
            <button className="btn-logout" onClick={onLogout}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function SectionAppearance({
  theme,
  onThemeToggle,
  compactNav,
  onCompactNavChange,
  animations,
  onAnimationsChange,
}) {
  return (
    <>
      <SettingsHeading title="Appearance">
        Customize how the FireTrackr interface looks.
      </SettingsHeading>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoAppearance} title="Theme">Choose the appearance that works best for you.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Color Mode</div>
            <div className="row-sub">
              Switch between dark and light interface theme
            </div>
          </div>
          <div className="row-right">
            <div className="theme-options">
              <button type="button"
                className={`theme-opt${theme === "dark" ? " selected" : ""}`}
                aria-pressed={theme === "dark"}
                onClick={() => theme !== "dark" && onThemeToggle()}
              >
                <div
                  className={`theme-preview tp-dark${
                    theme === "dark" ? " selected" : ""
                  }`}
                />
                <span className="theme-name">Dark</span>
              </button>
              <button type="button"
                className={`theme-opt${theme === "light" ? " selected" : ""}`}
                aria-pressed={theme === "light"}
                onClick={() => theme !== "light" && onThemeToggle()}
              >
                <div
                  className={`theme-preview tp-light${
                    theme === "light" ? " selected" : ""
                  }`}
                />
                <span className="theme-name">Light</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoAppearance} title="Interface">Adjust navigation and motion to suit your workflow.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Compact Sidebar</div>
            <div className="row-sub">
              Show icons only in the navigation sidebar
            </div>
          </div>
          <div className="row-right">
            <Toggle label="Compact Sidebar" on={compactNav} onChange={onCompactNavChange} />
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Animations</div>
            <div className="row-sub">Enable UI motion and transitions</div>
          </div>
          <div className="row-right">
            <Toggle label="Animations" on={animations} onChange={onAnimationsChange} />
          </div>
        </div>
      </div>
    </>
  );
}

/* Every row here gates a real alert (see useNotifications). Two rows changed
   meaning when they were wired up:

   - "Dispatch Confirmations / Notify when a unit acknowledges dispatch"
     described an event the system cannot produce — nothing ever sets a
     dispatch to "en_route" and there is no acknowledgement endpoint. It is
     repointed at arrival, which the backend does record.
   - Auto-dispatch failure was already broadcast and silently dropped, which
     meant nobody being en route to a logged fire showed up nowhere on the
     dashboard. It gets its own row. */
function SectionNotifications({ prefs, onPrefChange, isAdmin }) {
  const bind = (key, label) => ({
    label,
    on: !!prefs[key],
    onChange: (v) => onPrefChange(key, v),
  });

  return (
    <>
      <SettingsHeading title="Notifications">
        Control how and when you receive system alerts.
      </SettingsHeading>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoNotifications} title="Incident Alerts">Choose which incident updates you receive.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">New Incident Reports</div>
            <div className="row-sub">
              Alert when a new fire incident is logged
            </div>
          </div>
          <div className="row-right">
            <Toggle {...bind("newIncident", "New Incident Reports")} />
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Alarm Escalations</div>
            <div className="row-sub">Notify on alarm level upgrades</div>
          </div>
          <div className="row-right">
            <Toggle {...bind("escalation", "Alarm Escalations")} />
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Fire Contained</div>
            <div className="row-sub">
              Alert when a team leader marks a fire contained
            </div>
          </div>
          <div className="row-right">
            <Toggle {...bind("contained", "Fire Contained")} />
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Incident Reports</div>
            <div className="row-sub">
              Alert when an after-action report is filed from the field
            </div>
          </div>
          <div className="row-right">
            <Toggle {...bind("reportFiled", "Incident Reports")} />
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Incident Resolution</div>
            <div className="row-sub">Alert when an incident is closed</div>
          </div>
          <div className="row-right">
            <Toggle {...bind("resolution", "Incident Resolution")} />
          </div>
        </div>
      </div>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoNotifications} title="Personnel &amp; Dispatch">Stay informed about field activity and dispatch.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Personnel & Unit On Scene</div>
            <div className="row-sub">
              Alert when personnel or a unit confirms arrival at the scene
            </div>
          </div>
          <div className="row-right">
            <Toggle {...bind("onScene", "Personnel & Unit On Scene")} />
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Auto-Dispatch Failures</div>
            <div className="row-sub">
              Alert when no unit could be auto-dispatched to a fire
            </div>
          </div>
          <div className="row-right">
            <Toggle {...bind("autoDispatchFailed", "Auto-Dispatch Failures")} />
          </div>
        </div>
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">IoT Device Offline</div>
            <div className="row-sub">
              Alert when a personnel tracker goes offline
            </div>
          </div>
          <div className="row-right">
            <Toggle {...bind("deviceOffline", "IoT Device Offline")} />
          </div>
        </div>
      </div>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoNotifications} title="Delivery">Manage model updates and alert sounds.</SettingsBlockHeading>
        <div className="block-row">
          <div className="row-left"><div className="row-label">Connection recovery</div><div className="row-sub">Notify when missed alerts or current status cannot be fully recovered after reconnecting</div></div>
          <div className="row-right"><Toggle {...bind("connectionRecovery", "Connection recovery")} /></div>
        </div>
        {isAdmin && <div className="block-row">
          <div className="row-left"><div className="row-label">Model updates</div><div className="row-sub">Notify when training finishes or the active model changes</div></div>
          <div className="row-right"><Toggle {...bind("modelUpdates", "Model updates")} /></div>
        </div>}
        <div className="block-row">
          <div className="row-left">
            <div className="row-label">Alert Sound</div>
            <div className="row-sub">
              Play a chime for critical alerts. Browsers block audio until the
              page has been clicked once, so the first alert after a reload is
              silent.
            </div>
          </div>
          <div className="row-right">
            <Toggle {...bind("sound", "Alert Sound")} />
          </div>
        </div>
      </div>
    </>
  );
}

const MAP_LAYER_ROWS = [
  {
    key: "incidents",
    label: "Show Incident Markers",
    sub: "Display fire incident pins on the map",
  },
  {
    key: "personnel",
    label: "Show Personnel Markers",
    sub: "Display real-time field unit locations",
  },
  {
    key: "routes",
    label: "Show GNN Route Overlays",
    sub: "Display computed dispatch routes",
  },
  {
    key: "heatmap",
    label: "Show Heat Map Layer",
    sub: "Overlay historical incident density on the command view",
  },
  {
    key: "boundaries",
    label: "Show Barangay Boundaries",
    sub: "Overlay barangay polygons on the command view",
  },
];

function SectionMapDisplay({ prefs, onPrefChange }) {
  return (
    <>
      <SettingsHeading title="Map Display">
        Configure what is shown on the GIS command map. The Heat Map and
        Barangay view modes always show their own layer.
      </SettingsHeading>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoMapDisplay} title="Map Layers">Choose the information visible on your command map.</SettingsBlockHeading>
        {MAP_LAYER_ROWS.map((row) => (
          <div className="block-row" key={row.key}>
            <div className="row-left">
              <div className="row-label">{row.label}</div>
              <div className="row-sub">{row.sub}</div>
            </div>
            <div className="row-right">
              <Toggle
                label={row.label}
                on={!!prefs[row.key]}
                onChange={(v) => onPrefChange(row.key, v)}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SectionAbout() {
  return (
    <>
      <SettingsHeading title="About">
        System information and version details.
      </SettingsHeading>

      <div className="settings-block">
        <SettingsBlockHeading Icon={IcoAbout} title="FireTrackr Platform">Application details and system information.</SettingsBlockHeading>
        {[
          {
            label: "System Name",
            value: "FireTrackr Administrator Dashboard",
            badge: null,
            cls: "",
          },
          {
            label: "Version",
            value: "v1.0.0-beta",
            badge: "vb-green",
            cls: "",
          },
          {
            label: "GNN Model",
            value: "GNN-RL v2.1 · Online",
            badge: null,
            cls: "highlight",
          },
          {
            label: "Database",
            value: "PostgreSQL + PostGIS",
            badge: null,
            cls: "",
          },
          {
            label: "Backend",
            value: "FastAPI · Python 3.12",
            badge: null,
            cls: "",
          },
          {
            label: "Organization",
            value: "Bureau of Fire Protection – Panabo City",
            badge: null,
            cls: "",
          },
          {
            label: "Copyright",
            value: "© 2026 FireTrackr · All rights reserved.",
            badge: null,
            cls: "",
          },
        ].map((row) => (
          <div className="block-row" key={row.label}>
            <div className="row-left">
              <div className="row-label">{row.label}</div>
            </div>
            <div className="row-right">
              {row.badge ? (
                <span className={`val-badge ${row.badge}`}>{row.value}</span>
              ) : (
                <span className={`row-value ${row.cls}`}>{row.value}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function SettingsPage({
  user,
  theme,
  onThemeToggle,
  compactNav,
  onCompactNavChange,
  animations,
  onAnimationsChange,
  notifPrefs,
  onNotifPrefChange,
  mapLayerPrefs,
  onMapLayerPrefChange,
  onLogout,
  onAccountUpdate,
}) {
  const [activeId, setActiveId] = useState("profile");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const contentRef = useRef(null);

  // The cached profile in localStorage is whatever sign-in returned, so it goes
  // stale when an admin edits the record — and it predates any field added
  // since. Re-read it once when Settings opens; a failure is silent because the
  // cached copy is still a usable fallback.
  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((fresh) => alive && onAccountUpdate({ user: fresh }))
      .catch(() => {});
    // Runs once per open: onAccountUpdate is a fresh closure on every App
    // render, and depending on it would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderContent() {
    switch (activeId) {
      case "profile":
        return (
          <SectionProfile user={user} onAccountUpdate={onAccountUpdate} />
        );
      case "security":
        return (
          <SectionSecurity user={user} onAccountUpdate={onAccountUpdate} />
        );
      case "session":
        return <SectionSession onLogout={() => setConfirmLogout(true)} />;
      case "appearance":
        return (
          <SectionAppearance
            theme={theme}
            onThemeToggle={onThemeToggle}
            compactNav={compactNav}
            onCompactNavChange={onCompactNavChange}
            animations={animations}
            onAnimationsChange={onAnimationsChange}
          />
        );
      case "notifications":
        return (
          <SectionNotifications
            prefs={notifPrefs}
            onPrefChange={onNotifPrefChange}
            isAdmin={user?.role === "admin"}
          />
        );
      case "display":
        return (
          <SectionMapDisplay
            prefs={mapLayerPrefs}
            onPrefChange={onMapLayerPrefChange}
          />
        );
      case "about":
        return <SectionAbout />;
      case "model":
        return user?.role === "admin" ? <Suspense fallback={<SettingsLoading message="Loading model settings…" description="Getting the latest model status and version history." />}><ModelSettings theme={theme} /></Suspense> : null;
      default:
        return null;
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-body">
        <nav className="settings-sidebar" aria-label="Settings sections">
          {SIDEBAR_ITEMS.map(({ section, label, items }) => (
            <div key={section}>
              <div className="sidebar-section-label">{label}</div>
              {items.filter((item) => !item.adminOnly || user?.role === "admin").map((item) => (
                <button type="button"
                  key={item.id}
                  className={`settings-sidebar-item${
                    activeId === item.id ? " active" : ""
                  }`}
                  onClick={() => {
                    setActiveId(item.id);
                    if (contentRef.current) contentRef.current.scrollTop = 0;
                  }}
                  aria-current={activeId === item.id ? "page" : undefined}
                >
                  <item.Icon className="sidebar-item-icon" />
                  {item.label}
                </button>
              ))}
              <div className="sidebar-gap" />
              {section === "system" ? null : <hr className="sidebar-divider" />}
            </div>
          ))}
        </nav>

        <div className="settings-content" ref={contentRef}><div className="settings-section">{renderContent()}</div></div>
      </div>

      {confirmLogout && (
        <SignOutModal
          eyebrow={null}
          user={user}
          onConfirm={onLogout}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}
