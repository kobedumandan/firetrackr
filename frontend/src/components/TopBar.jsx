import { useEffect, useState } from "react";
import "../styles/TopBar.css";
import SignOutModal from "./SignOutModal";
import { getCurrentShift } from "../utils/shift";
import { BellIcon } from "./notificationUi";
import { COMMAND_SHORTCUT } from "../hooks/useCommandShortcut";

function PointUpIcon({className}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className={className}
      fill="currentColor"
    >
      <path d="m296-345-56-56 240-240 240 240-56 56-184-183-184 183Z" />
    </svg>
  );
}

function IcoLogout({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
    >
      <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z" />
    </svg>
  );
}

function NavIcon({ className, children }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className={className}
      fill="currentColor"
    >
      {children}
    </svg>
  );
}

function CommandIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="M864-40 741-162q-18 11-38.5 16.5T660-140q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 23-6 43.5T797-218L920-96l-56 56ZM220-140q-66 0-113-47T60-300q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-80q33 0 56.5-23.5T300-300q0-33-23.5-56.5T220-380q-33 0-56.5 23.5T140-300q0 33 23.5 56.5T220-220Zm440 0q33 0 56.5-23.5T740-300q0-33-23.5-56.5T660-380q-33 0-56.5 23.5T580-300q0 33 23.5 56.5T660-220ZM220-580q-66 0-113-47T60-740q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm440 0q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm-440-80q33 0 56.5-23.5T300-740q0-33-23.5-56.5T220-820q-33 0-56.5 23.5T140-740q0 33 23.5 56.5T220-660Zm440 0q33 0 56.5-23.5T740-740q0-33-23.5-56.5T660-820q-33 0-56.5 23.5T580-740q0 33 23.5 56.5T660-660ZM220-300Zm0-440Zm440 0Z" />
    </NavIcon>
  );
}

function MetricsIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="M120-160v-520l160 120 200-280 200 160h160v520H120Zm200-120 160-220 280 218v-318H652L496-725 298-447l-98-73v144l120 96Z" />
    </NavIcon>
  );
}

function IncidentsIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </NavIcon>
  );
}

function PersonnelIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q560-607 560-640t-23.5-56.5Q513-720 480-720t-56.5 23.5Q400-673 400-640t23.5 56.5Q447-560 480-560t56.5-23.5ZM480-640Zm0 400Z" />
    </NavIcon>
  );
}

function TeamsIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="m160-419 101-101-101-101L59-520l101 101Zm540-21 100-160 100 160H700Zm-220-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm0-160q-17 0-28.5 11.5T440-600q0 17 11.5 28.5T480-560q17 0 28.5-11.5T520-600q0-17-11.5-28.5T480-640Zm0 40ZM0-240v-63q0-44 44.5-70.5T160-400q13 0 25 .5t23 2.5q-14 20-21 43t-7 49v65H0Zm240 0v-65q0-65 66.5-105T480-450q108 0 174 40t66 105v65H240Zm560-160q72 0 116 26.5t44 70.5v63H780v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5Zm-320 30q-57 0-102 15t-53 35h311q-9-20-53.5-35T480-370Zm0 50Z" />
    </NavIcon>
  );
}

function StationsIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="M300-240v-360h360v360-360H300v360Zm-60 0h60v-360h360v360h60v-366L480-780 240-606v366Zm120-240h240v-60H360v60Zm120-160q17 0 28.5-11.5T520-680q0-17-11.5-28.5T480-720q-17 0-28.5 11.5T440-680q0 17 11.5 28.5T480-640ZM160-160v-400H39l441-320 440 320H800v400H600v-260H360v260H160Z" />
    </NavIcon>
  );
}

function TrucksIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="M195-155q-35-35-35-85h-40q-33 0-56.5-23.5T40-320v-200h440v-160q0-33 23.5-56.5T560-760h80v-40q0-17 11.5-28.5T680-840h40q17 0 28.5 11.5T760-800v40h22q26 0 47 15t29 40l58 172q2 6 3 12.5t1 13.5v267H800q0 50-35 85t-85 35q-50 0-85-35t-35-85H400q0 50-35 85t-85 35q-50 0-85-35Zm113.5-56.5Q320-223 320-240t-11.5-28.5Q297-280 280-280t-28.5 11.5Q240-257 240-240t11.5 28.5Q263-200 280-200t28.5-11.5Zm400 0Q720-223 720-240t-11.5-28.5Q697-280 680-280t-28.5 11.5Q640-257 640-240t11.5 28.5Q663-200 680-200t28.5-11.5ZM120-440v120h71q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h111v-120H120Zm440 120h31q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h71v-120H560v120Zm0-200h276l-54-160H560v160ZM40-560v-60h40v-80H40v-60h400v60h-40v80h40v60H40Zm100-60h70v-80h-70v80Zm130 0h70v-80h-70v80Zm210 180H120h360Zm80 0h280-280Z" />
    </NavIcon>
  );
}

function AnalysisNavIcon(props) {
  return (
    <NavIcon {...props}>
      <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-160q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-160Z" />
    </NavIcon>
  );
}

const NAV_ITEMS = [
  { label: "Command", Icon: CommandIcon },
  { label: "Metrics", Icon: MetricsIcon },
  { label: "Analysis", Icon: AnalysisNavIcon },
  { label: "Incidents", Icon: IncidentsIcon },
  { label: "Personnel", Icon: PersonnelIcon },
  { label: "Teams", Icon: TeamsIcon },
  { label: "Stations", Icon: StationsIcon },
  { label: "Trucks", Icon: TrucksIcon },
];

export default function TopBar({
  activeNav,
  constraintEditing = false,
  onNavChange,
  theme,
  onThemeToggle,
  onOpenSettings,
  showingSettings,
  user,
  onLogout,
  unreadCount = 0,
  onToggleAlerts,
  alertsOpen = false,
}) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [shift, setShift] = useState(() => getCurrentShift());

  useEffect(() => {
    const id = setInterval(() => setShift(getCurrentShift()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="topbar">
      <div
        className={`user-chip${showingSettings ? " active" : ""}`}
        onClick={onOpenSettings}
        style={{ cursor: "pointer" }}
      >
        <div className="user-avatar-name-wrap">
          <div className="user-avatar">
            {`${user?.first_name?.[0] ?? ""}${
              user?.last_name?.[0] ?? ""
            }`.toUpperCase() || "??"}
          </div>
          <div className="user-chip-name-wrap">
            <span className="user-chip-name">
              {user?.first_name
                ? `${user.first_name[0]}. ${user.last_name ?? ""}`.trim()
                : user?.email ?? "—"}
            </span>
            <span className="user-chip-role">System Administrator</span>
          </div>
        </div>
        <div className="user-chip-btn-wrap">
          <PointUpIcon className={"user-chip-btn"}/>
          <PointUpIcon className={"user-chip-btn-reverse"}/>
        </div>
      </div>

      <div className="topbar-spacer" />

      <nav className="topbar-nav">
        {NAV_ITEMS.filter(({ label }) => !constraintEditing || label !== "Incidents").map(({ label, Icon }) => (
          <span key={label} style={{ display: "contents" }}>
            {label === "Incidents" && <div className="section-divider" />}
            <button
              className={`nav-btn${
                !showingSettings && activeNav === label ? " active" : ""
              }`}
              onClick={() => onNavChange(label)}
              /* data-label feeds the CSS tooltip that replaces the text when
                 the rail is compacted — see [data-nav="compact"] in TopBar.css */
              data-label={label === "Command" ? `${label} (${COMMAND_SHORTCUT})` : label}
              aria-keyshortcuts={label === "Command" ? COMMAND_SHORTCUT : undefined}
              title={label === "Command" ? `Command (${COMMAND_SHORTCUT})` : undefined}
            >
              <Icon className="nav-btn-icon" />
              <span className="nav-btn-label">{label}</span>
              {label === "Command" && (showingSettings || activeNav !== "Command") && (
                <span className="nav-btn-shortcut" aria-hidden="true">
                  <svg className="nav-btn-shortcut-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                    <rect x="2" y="5" width="20" height="14" rx="3" />
                    <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" />
                  </svg>
                  {COMMAND_SHORTCUT}
                </span>
              )}
            </button>
          </span>
        ))}
      </nav>

      <div className="topbar-bottom">
        {/* .nav-btn + data-label buys the compact rail's 34x34 square sizing
            and its hover label for free — only the badge needs its own
            compact rule. */}
        <button
          className={`nav-btn topbar-alerts-btn${alertsOpen ? " active" : ""}`}
          onClick={onToggleAlerts}
          data-label="Alerts"
          aria-expanded={alertsOpen}
        >
          <BellIcon className="nav-btn-icon" />
          <span className="nav-btn-label">Alerts</span>
          {unreadCount > 0 && (
            <span
              className="topbar-alerts-badge"
              aria-label={`${unreadCount} unread alert${unreadCount === 1 ? "" : "s"}`}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        <div className="current-shift">
          <div className="current-shift-header">
            <span className="current-shift-label">Current Shift</span>
            <span className={`current-shift-badge shift-${shift.letter.toLowerCase()}`}>
              {shift.letter}
            </span>
          </div>
          <div className="current-shift-window">{shift.window}</div>
        </div>
        <button
          className="topbar-signout-btn"
          onClick={() => setConfirmLogout(true)}
          data-label="Sign Out"
        >
          <IcoLogout className="logout-icon" />
          <span className="nav-btn-label">Sign Out</span>
        </button>
      </div>

      {confirmLogout && (
        <SignOutModal
          user={user}
          onConfirm={onLogout}
          onClose={() => setConfirmLogout(false)}
        />
      )}
    </header>
  );
}
