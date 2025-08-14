import { VersionDisplay } from "./version-display";

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="bg-white border-t border-gray-200 py-2 px-6 mt-auto">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div>
          <span>© {currentYear}</span>
        </div>
        <div className="text-xs">
          <VersionDisplay />
        </div>
      </div>
    </footer>
  );
}