import { useContext } from "react";
import { Menu, X } from "lucide-react";
import SidebarContext from "../contexts/SidebarContext";
import styles from "./MobileSidebarToggle.module.css";

export default function MobileSidebarToggle() {
  const sidebar = useContext(SidebarContext);

  if (!sidebar) return null;

  return (
    <button
      type="button"
      className={styles.button}
      onClick={sidebar.toggle}
      aria-label={sidebar.isOpen ? "Close navigation" : "Open navigation"}
      aria-expanded={sidebar.isOpen}
      aria-controls="app-sidebar"
    >
      {sidebar.isOpen ? <X size={20} /> : <Menu size={20} />}
    </button>
  );
}
