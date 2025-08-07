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
              minWidth: 'auto',
              maxWidth: '400px',
              width: 'auto',
              height: 'auto',
              padding: '12px 32px 12px 16px',
              fontSize: '13px',
              lineHeight: '1.4',
              overflow: 'visible',
              whiteSpace: 'normal',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative'
            }}
          >
            <div className="grid gap-1 flex-1" style={{ 
              width: '100%',
              overflow: 'visible',
              fontSize: '13px',
              lineHeight: '1.4'
            }}>
              {title && (
                <ToastTitle style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  lineHeight: '1.3',
                  margin: '0 0 4px 0',
                  width: '100%',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  whiteSpace: 'normal',
                  display: 'block'
                }}>
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription style={{
                  fontSize: '12px',
                  lineHeight: '1.4',
                  margin: '0',
                  width: '100%',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  whiteSpace: 'normal',
                  display: 'block'
                }}>
                  {description}
                </ToastDescription>
              )}
            </div>
            <ToastClose style={{ 
              fontSize: '12px', 
              padding: '4px',
              width: '16px',
              height: '16px',
              position: 'absolute',
              top: '12px',
              right: '12px'
            }} />
          </Toast>
        )
      })}
      <ToastViewport style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 999999,
        maxWidth: '400px',
        width: 'auto'
      }} />
    </ToastProvider>
  )
}
