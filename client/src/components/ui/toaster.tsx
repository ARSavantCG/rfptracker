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
              minWidth: 'fit-content',
              maxWidth: '500px',
              width: 'auto',
              height: 'auto',
              padding: '16px 20px',
              fontSize: '13px',
              lineHeight: '1.4',
              overflow: 'visible',
              whiteSpace: 'nowrap',
              display: 'inline-block',
              position: 'relative'
            }}
          >
            <div style={{ 
              width: 'auto',
              overflow: 'visible',
              fontSize: '13px',
              lineHeight: '1.4',
              display: 'inline-block'
            }}>
              {title && (
                <ToastTitle style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  lineHeight: '1.3',
                  margin: '0',
                  width: 'auto',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  whiteSpace: 'nowrap',
                  display: 'inline-block'
                }}>
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription style={{
                  fontSize: '12px',
                  lineHeight: '1.4',
                  margin: '2px 0 0 0',
                  width: 'auto',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  whiteSpace: 'nowrap',
                  display: 'block'
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
        maxWidth: '500px',
        width: 'auto'
      }} />
    </ToastProvider>
  )
}
