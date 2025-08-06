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
            className="min-w-[600px] min-h-[140px] p-8 max-w-[700px]"
            style={{
              minWidth: '600px',
              minHeight: '140px', 
              maxWidth: '700px',
              padding: '32px',
              fontSize: '16px',
              lineHeight: '1.6'
            }}
          >
            <div className="grid gap-3 flex-1">
              {title && (
                <ToastTitle 
                  className="text-xl font-bold leading-tight"
                  style={{
                    fontSize: '18px',
                    fontWeight: '700',
                    lineHeight: '1.3',
                    wordWrap: 'break-word'
                  }}
                >
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription 
                  className="text-base leading-relaxed"
                  style={{
                    fontSize: '14px',
                    lineHeight: '1.5',
                    wordWrap: 'break-word'
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
