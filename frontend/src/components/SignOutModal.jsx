import ConfirmModal from "./ConfirmModal";

/* Sign-out confirmation, shared by the top bar and Settings → Session. */
export default function SignOutModal({ user, onConfirm, onClose, eyebrow = "SESSION" }) {
  const name = user?.first_name
    ? `${user.first_name} ${user.last_name ?? ""}`.trim()
    : null;
  return (
    <ConfirmModal
      eyebrow={eyebrow}
      icon="logout"
      title="Sign out of FireTrackr?"
      details={[
        ...(name ? [{ label: "Signed in as", value: name }] : []),
        { label: "Account", value: user?.email },
      ]}
      message="You'll need to sign in again to use the dashboard. Anything you haven't saved will be lost."
      confirmLabel="Sign out"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
