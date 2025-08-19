import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, FileText, Users, ClipboardCheck, Award, FileOutput, CheckCircle, ChevronUp, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { RfpRequest } from "@shared/schema";

interface WorkflowStatusProps {
  rfp: RfpRequest;
  onAdvanceToInvitation: (rfp: RfpRequest) => void;
  onEditRfp?: (rfp: RfpRequest) => void;
  onValidateRfp?: (rfp: RfpRequest) => void;
  onOpenInvitationModal?: (rfp: RfpRequest) => void;
  onOpenBidCollection?: (rfp: RfpRequest) => void;
  onOpenEvaluation?: (rfp: RfpRequest) => void;
  onOpenPublish?: (rfp: RfpRequest) => void;
  onViewDetails?: (rfp: RfpRequest) => void;
}

const workflowPhases = [
  { 
    key: "rfp-entry", 
    label: "RFP Entry", 
    icon: FileText, 
    color: "bg-blue-100 text-blue-700 border-blue-300",
    description: "Initial RFP data collection"
  },
  { 
    key: "rfp-validation", 
    label: "RFP Validation", 
    icon: ClipboardCheck, 
    color: "bg-green-100 text-green-700 border-green-300",
    description: "Review and edit validation details"
  },
  { 
    key: "invitation-to-bid", 
    label: "Invitation to Bid", 
    icon: Users, 
    color: "bg-orange-100 text-orange-700 border-orange-300",
    description: "Prepare and send bid invitations"
  },
  { 
    key: "bid-collection", 
    label: "Bid Collection", 
    icon: ClipboardCheck, 
    color: "bg-purple-100 text-purple-700 border-purple-300",
    description: "Collect and review submitted bids"
  },
  { 
    key: "evaluation", 
    label: "Evaluation", 
    icon: Award, 
    color: "bg-yellow-100 text-yellow-700 border-yellow-300",
    description: "Evaluate and compare bids"
  },
  { 
    key: "publish", 
    label: "Publish Evaluation Data", 
    icon: FileOutput, 
    color: "bg-green-100 text-green-700 border-green-300",
    description: "Publish Evaluation Data"
  }
];

export function WorkflowStatus({ rfp, onAdvanceToInvitation, onEditRfp, onValidateRfp, onOpenInvitationModal, onOpenBidCollection, onOpenEvaluation, onOpenPublish, onViewDetails }: WorkflowStatusProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const advancePhaseMutation = useMutation({
    mutationFn: async (newPhase: string) => {
      return apiRequest(`/api/rfp-requests/${rfp.id}/workflow-phase`, "PATCH", { phase: newPhase });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Workflow advanced",
        description: "Project has been moved to the next phase",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to advance workflow phase",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  const completeProjectMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/rfp-requests/${rfp.id}`, "PATCH", { status: "completed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfp-requests/stats"] });
      toast({
        title: "Project Completed",
        description: "RFP has been marked as completed successfully",
        duration: 4000,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark project as completed",
        variant: "destructive",
        duration: 6000,
      });
    },
  });

  // Map RFP status to workflow phase to ensure sync
  const getWorkflowPhaseFromStatus = (status: string, workflowPhase: string) => {
    // Just return the actual workflow phase - don't override based on status
    return workflowPhase;
  };

  const actualWorkflowPhase = getWorkflowPhaseFromStatus(rfp.status, rfp.workflowPhase);
  const currentPhaseIndex = workflowPhases.findIndex(phase => phase.key === actualWorkflowPhase);
  const nextPhase = workflowPhases[currentPhaseIndex + 1];

  const handleAdvancePhase = () => {
    if (nextPhase) {
      // Always advance the workflow phase
      advancePhaseMutation.mutate(nextPhase.key);
    }
  };

  const handlePhaseClick = (phase: any) => {
    if (phase.key === "rfp-entry" && onEditRfp) {
      onEditRfp(rfp);
    } else if (phase.key === "rfp-validation" && onValidateRfp) {
      onValidateRfp(rfp);
    } else if (phase.key === "invitation-to-bid" && onOpenInvitationModal) {
      onOpenInvitationModal(rfp);
    } else if (phase.key === "bid-collection" && onOpenBidCollection) {
      onOpenBidCollection(rfp);
    } else if (phase.key === "evaluation" && onOpenEvaluation) {
      onOpenEvaluation(rfp);
    } else if (phase.key === "publish" && onOpenPublish) {
      onOpenPublish(rfp);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-900">Workflow Status</h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Phase {currentPhaseIndex + 1} of {workflowPhases.length}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-6 w-6 p-0 hover:bg-gray-100"
            title={isCollapsed ? "Expand workflow" : "Minimize workflow"}
          >
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      
      {!isCollapsed && (
        <>
          {/* View Details Button */}
          <div className="mb-3">
        <Button
          onClick={() => onViewDetails?.(rfp)}
          variant="outline"
          className="w-full px-2 py-1.5 text-xs font-medium flex items-center justify-center gap-1.5"
          size="sm"
        >
          <FileText className="h-3.5 w-3.5" />
          View RFP Details
        </Button>
      </div>

      <div className="space-y-2">
        {workflowPhases.map((phase, index) => {
          const Icon = phase.icon;
          // For archived RFPs, no phase should be active (all completed)
          const isActive = phase.key === actualWorkflowPhase && rfp.status !== "completed" && rfp.status !== "archived";
          // For archived RFPs or completed projects, show all phases as completed
          const isCompleted = rfp.status === "archived" || index < currentPhaseIndex || (phase.key === "publish" && rfp.status === "completed");
          const isNext = index === currentPhaseIndex + 1 && rfp.status !== "archived";

          const isClickable = (isActive || isCompleted) && (phase.key === "rfp-entry" || phase.key === "rfp-validation" || phase.key === "invitation-to-bid" || phase.key === "bid-collection" || phase.key === "evaluation" || phase.key === "publish");
          
          return (
            <div
              key={phase.key}
              onClick={() => isClickable && handlePhaseClick(phase)}
              className={`flex items-center space-x-2 p-2 rounded-lg border transition-colors ${
                isActive
                  ? "bg-blue-100 text-blue-700 border-blue-300"
                  : isCompleted
                  ? "bg-green-100 text-green-700 border-green-300"
                  : "bg-gray-50 text-gray-400 border-gray-200"
              } ${isClickable ? "cursor-pointer hover:bg-opacity-80" : ""}`}
            >
              <Icon className={`h-4 w-4 ${
                isActive 
                  ? "text-blue-600" 
                  : isCompleted 
                  ? "text-green-600" 
                  : "text-gray-400"
              }`} />
              <div className="flex-1">
                <div className="flex items-center space-x-1.5">
                  <span className={`font-medium text-xs ${isActive ? "text-gray-900" : ""}`}>
                    {phase.label}
                  </span>
                  {isCompleted && <FileOutput className="h-3 w-3 text-green-600" />}
                  {isActive && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">
                      Current
                    </Badge>
                  )}
                </div>
                <p className="text-xs opacity-75 mt-0.5">{phase.description}</p>
              </div>
              {isNext && (
                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
              )}
            </div>
          );
        })}
      </div>

          <div className="mt-3 pt-3 border-t border-gray-200">
            {rfp.status === "archived" ? (
              /* Archived RFPs only show view summary option */
              <div className="space-y-2">
                <Button
                  onClick={() => onOpenPublish?.(rfp)}
                  variant="outline"
                  className="w-full px-4 py-2 text-sm"
                >
                  View Project Summary
                </Button>
              </div>
            ) : (
              /* Active RFPs show current phase actions */
              <div className="space-y-2">
          {actualWorkflowPhase === "rfp-entry" && (
            <div className="text-sm text-gray-500 text-center py-2">
              Use "Create RFP & Advance" to begin workflow
            </div>
          )}
          
          {actualWorkflowPhase === "rfp-validation" && (
            <div className="space-y-2">
              <Button
                onClick={() => onValidateRfp?.(rfp)}
                variant="outline"
                className="w-full px-4 py-2 text-sm"
              >
                Edit Validation Details
              </Button>
              <Button
                onClick={handleAdvancePhase}
                disabled={advancePhaseMutation.isPending}
                className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white"
              >
                {advancePhaseMutation.isPending
                  ? "Advancing..."
                  : "Advance to Invitation to Bid"}
              </Button>
            </div>
          )}
          
          {actualWorkflowPhase === "invitation-to-bid" && (
            <div className="space-y-2">
              <Button
                onClick={() => onOpenInvitationModal?.(rfp)}
                variant="outline"
                className="w-full px-4 py-2 text-sm"
              >
                Generate ITB Documents
              </Button>
              <Button
                onClick={handleAdvancePhase}
                disabled={advancePhaseMutation.isPending}
                className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white"
              >
                {advancePhaseMutation.isPending
                  ? "Advancing..."
                  : "Advance to Bid Collection"}
              </Button>
            </div>
          )}

          {actualWorkflowPhase === "bid-collection" && (
            <div className="space-y-2">
              <Button
                onClick={() => onOpenBidCollection?.(rfp)}
                variant="outline"
                className="w-full px-4 py-2 text-sm"
              >
                Manage Bids
              </Button>
            </div>
          )}

          {actualWorkflowPhase === "evaluation" && (
            <div className="space-y-2">
              <Button
                onClick={() => onOpenEvaluation?.(rfp)}
                variant="outline"
                className="w-full px-4 py-2 text-sm"
              >
                Budget Evaluation
              </Button>
              <Button
                onClick={handleAdvancePhase}
                disabled={advancePhaseMutation.isPending}
                className="w-full px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white"
              >
                {advancePhaseMutation.isPending
                  ? "Advancing..."
                  : "Advance to Publish"}
              </Button>
            </div>
          )}

          {actualWorkflowPhase === "publish" && (
            <div className="space-y-2">
              <Button
                onClick={() => onOpenPublish?.(rfp)}
                variant="outline"
                className="w-full px-4 py-2 text-sm"
              >
                View Project Summary
              </Button>
              {rfp.status !== "completed" && (
                <Button
                  onClick={() => completeProjectMutation.mutate()}
                  disabled={completeProjectMutation.isPending}
                  className="w-full px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  {completeProjectMutation.isPending
                    ? "Marking Complete..."
                    : "Mark Project as Complete (Publish)"}
                </Button>
              )}
            </div>
            )}
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}