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
              padding: '12px 16px',
              fontSize: '13px',
              lineHeight: '1.4',
              overflow: 'visible',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
              margin: '0',
              gap: '8px'
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
            <ToastClose style={{
              position: 'relative',
              top: 'auto',
              right: 'auto',
              transform: 'none',
              width: '16px',
              height: '16px',
              padding: '0',
              border: 'none',
              background: 'rgba(0, 0, 0, 0.05)',
              color: '#6b7280',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              zIndex: '100',
              borderRadius: '4px',
              margin: '0',
              flexShrink: '0'
            }} />
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
