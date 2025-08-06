import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast 
            key={id} 
            {...props} 
            className="!min-w-[700px] !min-h-[160px] !p-8 !max-w-[800px] !overflow-visible"
            style={{
              minWidth: '700px !important',
              minHeight: '160px !important', 
              maxWidth: '800px !important',
              padding: '32px !important',
              fontSize: '16px',
              lineHeight: '1.6',
              overflow: 'visible !important',
              zIndex: 9999
            }}
          >
            <div className="grid gap-3 flex-1">
              {title && (
                <ToastTitle 
                  className="!text-xl !font-bold !leading-tight"
                  style={{
                    fontSize: '16px !important',
                    fontWeight: '700 !important',
                    lineHeight: '1.3 !important',
                    wordWrap: 'break-word',
                    maxWidth: '600px'
                  }}
                >
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription 
                  className="!text-base !leading-relaxed"
                  style={{
                    fontSize: '13px !important',
                    lineHeight: '1.4 !important',
                    wordWrap: 'break-word',
                    maxWidth: '600px'
                  }}
                >
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
