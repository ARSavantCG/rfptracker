import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Navigation from "@/components/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Search, FileText, Tag, ExternalLink, Building, Calendar, DollarSign, Paperclip } from "lucide-react";
import { BidTaggingModal } from "@/components/bid-tagging-modal";
import type { RfpFile } from "@shared/schema";

interface Proposal {
  bidCollectionId: number;
  rfpId: number;
  contractorId: number;
  contractorName: string;
  contractorCompany: string;
  contractorEmail: string;
  submissionDate: string;
  totalAmount: string | null;
  attachments: RfpFile[];
  rfpNumber: string;
  projectName: string;
  tenantName: string;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("");
}

const COMPANY_COLORS = [
  "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
  "bg-rose-500", "bg-teal-500", "bg-indigo-500", "bg-amber-500",
];

function companyColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COMPANY_COLORS[Math.abs(hash) % COMPANY_COLORS.length];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatAmount(amt: string | null): string {
  if (!amt) return "—";
  const n = parseFloat(amt.replace(/[,$]/g, ""));
  if (isNaN(n)) return amt;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function ProposalsLibrary() {
  const [search, setSearch] = useState("");
  const [filterContractor, setFilterContractor] = useState("all");
  const [filterYear, setFilterYear] = useState("all");
  const [taggingTarget, setTaggingTarget] = useState<Proposal | null>(null);

  const { data: proposals = [], isLoading } = useQuery<Proposal[]>({
    queryKey: ["/api/proposals"],
  });

  // Derived filter options
  const contractorOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { id: number; company: string }[] = [];
    for (const p of proposals) {
      if (!seen.has(p.contractorCompany)) {
        seen.add(p.contractorCompany);
        opts.push({ id: p.contractorId, company: p.contractorCompany });
      }
    }
    return opts.sort((a, b) => a.company.localeCompare(b.company));
  }, [proposals]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const p of proposals) {
      if (p.submissionDate) years.add(new Date(p.submissionDate).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [proposals]);

  // Filter logic
  const filtered = useMemo(() => {
    let list = [...proposals];
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter(
        p =>
          p.contractorName.toLowerCase().includes(q) ||
          p.contractorCompany.toLowerCase().includes(q) ||
          p.projectName.toLowerCase().includes(q) ||
          p.tenantName.toLowerCase().includes(q)
      );
    }
    if (filterContractor !== "all") {
      list = list.filter(p => String(p.contractorId) === filterContractor);
    }
    if (filterYear !== "all") {
      list = list.filter(
        p => p.submissionDate && new Date(p.submissionDate).getFullYear() === parseInt(filterYear)
      );
    }
    return list;
  }, [proposals, search, filterContractor, filterYear]);

  // Summary stats
  const totalContractors = useMemo(() => new Set(proposals.map(p => p.contractorId)).size, [proposals]);
  const dateRange = useMemo(() => {
    if (!proposals.length) return "—";
    const dates = proposals.map(p => new Date(p.submissionDate).getTime()).filter(Boolean);
    if (!dates.length) return "—";
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    return min.getFullYear() === max.getFullYear() && min.getMonth() === max.getMonth()
      ? fmt(min)
      : `${fmt(min)} – ${fmt(max)}`;
  }, [proposals]);

  function buildPdfUrl(attachment: RfpFile): string {
    const p = attachment.path || "";
    if (!p) return "#";
    if (p.startsWith("/uploads/")) return p;
    if (p.startsWith("uploads/")) return `/${p}`;
    return `/uploads/${p}`;
  }

  function openPdf(attachment: RfpFile) {
    window.open(buildPdfUrl(attachment), "_blank");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            Proposals Library
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Contractor bid proposals with attachments — tag prices to the ROM Pilot pricing database
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Proposals", value: proposals.length, icon: FileText, color: "text-blue-600" },
            { label: "Contractors", value: totalContractors, icon: Building, color: "text-purple-600" },
            { label: "Date Range", value: dateRange, icon: Calendar, color: "text-green-600" },
            { label: "Showing", value: filtered.length, icon: Search, color: "text-orange-600" },
          ].map(stat => (
            <Card key={stat.label} className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <stat.icon className={`h-5 w-5 ${stat.color} flex-shrink-0`} />
                <div>
                  <p className="text-xs text-gray-500">{stat.label}</p>
                  <p className="text-lg font-bold text-gray-800">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search contractor, project, or tenant..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterContractor} onValueChange={setFilterContractor}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="All Contractors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Contractors</SelectItem>
              {contractorOptions.map(opt => (
                <SelectItem key={opt.id} value={String(opt.id)}>
                  {opt.company}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="All Years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {yearOptions.map(y => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Proposals grid */}
        {isLoading ? (
          <div className="text-center py-16 text-gray-400">Loading proposals...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-base font-medium">No proposals found</p>
            <p className="text-sm mt-1">
              {proposals.length === 0
                ? "Proposals appear here when bid collections have PDF attachments."
                : "Try adjusting your search or filters."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(proposal => {
              const initials = getInitials(proposal.contractorCompany);
              const colorClass = companyColor(proposal.contractorCompany);
              const pdfAttachments = proposal.attachments?.filter(
                a => a.type === "application/pdf" || a.name?.endsWith(".pdf")
              ) ?? [];
              const allAttachments = proposal.attachments ?? [];

              return (
                <Card key={proposal.bidCollectionId} className="border shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    {/* Contractor header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={`${colorClass} text-white rounded-full h-11 w-11 flex items-center justify-center text-sm font-bold flex-shrink-0`}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{proposal.contractorCompany}</p>
                        <p className="text-xs text-gray-500 truncate">{proposal.contractorName}</p>
                      </div>
                    </div>

                    {/* Project info */}
                    <div className="space-y-1.5 mb-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Building className="h-3.5 w-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="font-medium text-gray-800 truncate block">{proposal.projectName}</span>
                          <span className="text-gray-500 text-xs">{proposal.rfpNumber}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <Calendar className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <span className="text-xs">{formatDate(proposal.submissionDate)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <DollarSign className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <span className="text-sm font-medium">{formatAmount(proposal.totalAmount)}</span>
                      </div>
                    </div>

                    {/* Attachments count */}
                    <div className="flex items-center gap-1.5 mb-3">
                      <Paperclip className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">
                        {allAttachments.length} attachment{allAttachments.length !== 1 ? "s" : ""}
                        {pdfAttachments.length > 0 && (
                          <span className="text-blue-600 ml-1">({pdfAttachments.length} PDF)</span>
                        )}
                      </span>
                    </div>

                    {/* Tenant */}
                    <div className="mb-3">
                      <Badge variant="outline" className="text-xs font-normal text-gray-600">
                        {proposal.tenantName}
                      </Badge>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {pdfAttachments.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs flex items-center gap-1.5"
                          onClick={() => openPdf(pdfAttachments[0])}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          View PDF
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="flex-1 text-xs flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700"
                        onClick={() => setTaggingTarget(proposal)}
                      >
                        <Tag className="h-3.5 w-3.5" />
                        Tag Prices
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Tagging modal */}
      {taggingTarget && (
        <BidTaggingModal
          isOpen={!!taggingTarget}
          onClose={() => setTaggingTarget(null)}
          bidCollectionId={taggingTarget.bidCollectionId}
          contractorName={taggingTarget.contractorCompany}
          projectName={taggingTarget.projectName}
          submissionDate={taggingTarget.submissionDate}
          attachments={taggingTarget.attachments}
        />
      )}
    </div>
  );
}
