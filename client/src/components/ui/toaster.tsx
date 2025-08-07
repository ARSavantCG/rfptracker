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
            style={{
              minWidth: '280px',
              maxWidth: '350px',
              minHeight: '60px',
              maxHeight: '120px',
              padding: '8px 12px',
              fontSize: '11px',
              lineHeight: '1.2'
            }}
          >
            <div className="flex-1" style={{ maxWidth: '250px' }}>
              {title && (
                <ToastTitle style={{
                  fontSize: '11px',
                  fontWeight: '500',
                  lineHeight: '1.2',
                  margin: '0 0 2px 0',
                  maxWidth: '250px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription style={{
                  fontSize: '10px',
                  lineHeight: '1.2',
                  margin: '0',
                  maxWidth: '250px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose style={{ fontSize: '10px', padding: '2px' }} />
          </Toast>
        )
      })}
      <ToastViewport style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 999999,
        maxWidth: '350px'
      }} />
    </ToastProvider>
  )
}
