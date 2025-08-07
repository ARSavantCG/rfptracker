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
              minWidth: '240px !important',
              maxWidth: '320px !important',
              minHeight: '50px !important',
              maxHeight: '100px !important',
              padding: '6px 10px !important',
              fontSize: '9px !important',
              lineHeight: '1.1 !important',
              overflow: 'hidden !important'
            }}
          >
            <div className="flex-1" style={{ 
              maxWidth: '200px !important',
              overflow: 'hidden !important',
              fontSize: '9px !important',
              lineHeight: '1.1 !important'
            }}>
              {title && (
                <ToastTitle style={{
                  fontSize: '9px !important',
                  fontWeight: '500 !important',
                  lineHeight: '1.1 !important',
                  margin: '0 !important',
                  maxWidth: '200px !important',
                  overflow: 'hidden !important',
                  textOverflow: 'ellipsis !important',
                  whiteSpace: 'nowrap !important'
                }}>
                  {title}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription style={{
                  fontSize: '8px !important',
                  lineHeight: '1.1 !important',
                  margin: '0 !important',
                  maxWidth: '200px !important',
                  overflow: 'hidden !important',
                  textOverflow: 'ellipsis !important',
                  whiteSpace: 'nowrap !important'
                }}>
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose style={{ 
              fontSize: '8px !important', 
              padding: '2px !important',
              width: '16px !important',
              height: '16px !important'
            }} />
          </Toast>
        )
      })}
      <ToastViewport style={{
        position: 'fixed !important',
        bottom: '16px !important',
        right: '16px !important',
        zIndex: '999999 !important',
        maxWidth: '320px !important',
        fontSize: '8px !important',
        lineHeight: '1.1 !important'
      }} />
    </ToastProvider>
  )
}
