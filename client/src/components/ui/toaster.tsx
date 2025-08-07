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
              minWidth: '240px',
              maxWidth: '320px',
              minHeight: '50px',
              maxHeight: '100px',
              padding: '6px 10px',
              fontSize: '11px',
              lineHeight: '1.2',
              overflow: 'hidden'
            }}
          >
            <div className="flex-1" style={{ 
              maxWidth: '200px',
              overflow: 'hidden',
              fontSize: '11px',
              lineHeight: '1.2'
            }}>
              {title && (
                <ToastTitle style={{
                  fontSize: '11px',
                  fontWeight: '500',
                  lineHeight: '1.2',
                  margin: '0',
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription style={{
                  fontSize: '10px',
                  lineHeight: '1.2',
                  margin: '0',
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose style={{ 
              fontSize: '10px', 
              padding: '2px',
              width: '16px',
              height: '16px'
            }} />
          </Toast>
        )
      })}
      <ToastViewport style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 999999,
        maxWidth: '320px'
      }} />
    </ToastProvider>
  )
}
