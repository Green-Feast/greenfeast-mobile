import { useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native'
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors, Fonts } from '@/constants/colors'

type Props = {
  orderId: string
  amount: number       // in paise
  keyId: string
  userName: string
  userPhone: string
  onSuccess: (razorpayPaymentId: string) => void
  onFailure: (error: string) => void
  onDismiss: () => void
}

// Sanitize values interpolated into HTML to prevent injection
function s(v: string) {
  return v.replace(/[<>"'`\\]/g, '')
}

function buildCheckoutHtml(props: Props) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, sans-serif;
      background: #F9FBF7;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .center {
      text-align: center;
      color: #1B5E20;
    }
    .dot {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #1B5E20;
      margin: 0 3px;
      animation: bounce 1.2s infinite ease-in-out;
    }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
      40% { transform: scale(1); opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="center">
    <p style="font-size:15px;margin-bottom:16px;color:#555">Opening payment gateway…</p>
    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
  </div>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    function postMsg(data) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }

    var options = {
      key: "${s(props.keyId)}",
      amount: ${props.amount},
      currency: "INR",
      name: "GreenFeast",
      description: "Meal Subscription",
      order_id: "${s(props.orderId)}",
      prefill: {
        name: "${s(props.userName)}",
        contact: "${s(props.userPhone)}"
      },
      theme: { color: "#1B5E20" },
      handler: function(response) {
        postMsg({
          type: "success",
          payment_id: response.razorpay_payment_id,
          order_id: response.razorpay_order_id
        });
      },
      modal: {
        ondismiss: function() {
          postMsg({ type: "dismissed" });
        },
        escape: false
      }
    };

    var rzp = new Razorpay(options);
    rzp.on("payment.failed", function(response) {
      postMsg({
        type: "failed",
        error: response.error.description || "Payment failed. Please try again."
      });
    });
    rzp.open();
  </script>
</body>
</html>`
}

export default function RazorpayWebView(props: Props) {
  const insets = useSafeAreaInsets()
  const webViewRef = useRef<WebView>(null)

  function onMessage(event: WebViewMessageEvent) {
    try {
      const data = JSON.parse(event.nativeEvent.data)
      if (data.type === 'success') {
        props.onSuccess(data.payment_id)
      } else if (data.type === 'failed') {
        props.onFailure(data.error)
      } else if (data.type === 'dismissed') {
        props.onDismiss()
      }
    } catch {
      // malformed postMessage — ignore
    }
  }

  function onNavigationStateChange(state: WebViewNavigation) {
    // Allow all navigation within the checkout flow
    // External UPI deep links are handled by the OS, not by this WebView
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.lock}>
            <Text style={styles.lockIcon}>🔒</Text>
          </View>
          <Text style={styles.headerTitle}>Secure Payment</Text>
        </View>
        <TouchableOpacity onPress={props.onDismiss} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.cancelBtn}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <WebView
        ref={webViewRef}
        source={{ html: buildCheckoutHtml(props), baseUrl: 'https://checkout.razorpay.com' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading payment…</Text>
          </View>
        )}
        onShouldStartLoadWithRequest={(request) => {
          // Let Razorpay's checkout page load normally
          // Block any non-http redirect that isn't the initial load
          const url = request.url
          if (url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank') {
            return true
          }
          // Intent / deep link URLs (UPI apps) — let the OS handle them
          return false
        }}
        style={styles.webview}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: '#fff',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lock: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockIcon: { fontSize: 16 },
  headerTitle: {
    fontFamily: Fonts.bodySemi,
    fontSize: 15,
    color: Colors.text,
  },
  cancelBtn: {
    fontFamily: Fonts.bodySemi,
    fontSize: 14,
    color: Colors.danger,
  },
  webview: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    gap: 12,
  },
  loadingText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textMuted,
  },
})
