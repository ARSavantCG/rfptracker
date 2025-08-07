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
              minWidth: '300px',
              maxWidth: '400px',
              minHeight: 'auto',
              maxHeight: 'auto',
              padding: '12px 16px',
              fontSize: '12px',
              lineHeight: '1.4',
              overflow: 'visible'
            }}
          >
            <div className="grid gap-1 flex-1" style={{ 
              maxWidth: '350px',
              overflow: 'visible',
              fontSize: '12px',
              lineHeight: '1.4'
            }}>
              {title && (
                <ToastTitle style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  lineHeight: '1.3',
                  margin: '0 0 4px 0',
                  maxWidth: '350px',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  whiteSpace: 'normal'
                }}>
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription style={{
                  fontSize: '11px',
                  lineHeight: '1.4',
                  margin: '0',
                  maxWidth: '350px',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  whiteSpace: 'normal'
                }}>
                  {description}
                </ToastDescription>
              )}
            </div>
            <ToastClose style={{ 
              fontSize: '12px', 
              padding: '4px',
              width: '20px',
              height: '20px',
              position: 'absolute',
              top: '8px',
              right: '8px'
            }} />
          </Toast>
        )
      })}
      <ToastViewport style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 999999,
        maxWidth: '400px'
      }} />
    </ToastProvider>
  )
}
