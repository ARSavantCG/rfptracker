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
              maxWidth: 'none',
              width: 'fit-content',
              height: 'auto',
              padding: '12px 40px 12px 16px',
              fontSize: '13px',
              lineHeight: '1.4',
              overflow: 'visible',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              position: 'relative'
            }}
          >
            <div style={{ 
              width: 'auto',
              overflow: 'visible',
              fontSize: '13px',
              lineHeight: '1.4',
              display: 'flex',
              alignItems: 'center'
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
                  display: 'inline'
                }}>
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription style={{
                  fontSize: '12px',
                  lineHeight: '1.4',
                  margin: '0 0 0 4px',
                  width: 'auto',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  whiteSpace: 'nowrap',
                  display: 'inline'
                }}>
                  {description}
                </ToastDescription>
              )}
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 999999,
        maxWidth: 'none',
        width: 'auto'
      }} />
    </ToastProvider>
  )
}
