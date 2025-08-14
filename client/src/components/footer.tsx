import { VersionDisplay } from "./version-display";

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="bg-white border-t border-gray-200 py-2 px-6 mt-auto">
      <div className="flex items-center justify-center text-xs text-gray-500">
        <span>© {currentYear} All Rights Reserved</span>
      </div>
      <div className="flex justify-end mt-1">
        <VersionDisplay />
      </div>
    </footer>
  );
}