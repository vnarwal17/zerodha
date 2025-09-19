import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wifi, WifiOff, LogIn, User, AlertCircle, CheckCircle, Link as LinkIcon, Key, Eye, EyeOff, ExternalLink, Settings, AlertTriangle, Server, Zap } from "lucide-react";
import { useState, useEffect } from "react";
import { tradingApi } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface BrokerConnectionProps {
  isConnected: boolean;
  onConnectionChange: (connected: boolean, userData?: any) => void;
}

export function BrokerConnection({ isConnected, onConnectionChange }: BrokerConnectionProps) {
  const [loading, setLoading] = useState(false);
  const [testOrderLoading, setTestOrderLoading] = useState(false);
  const [requestToken, setRequestToken] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [userInfo, setUserInfo] = useState<any>(null);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showCredentialsSetup, setShowCredentialsSetup] = useState(false);
  const [showBackendError, setShowBackendError] = useState(false);
  
  // Credentials state
  const [apiKey, setApiKey] = useState("graf84f2wec04nbl");
  const [apiSecret, setApiSecret] = useState("rcaxwf44jd6en5yujwzgmm36hbwbffz6");
  const [showSecret, setShowSecret] = useState(false);
  const [credentialsSet, setCredentialsSet] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    checkConnection();
    // Check if credentials are already set
    if (apiKey && apiSecret) {
      setCredentialsSet(true);
    }
  }, []);

  const checkConnection = async () => {
    try {
      const response = await tradingApi.testConnection();
      if ((response.status === 'success' || response.status === 'connected') && response.data) {
        setUserInfo(response.data);
        onConnectionChange(true, response.data);
      } else if (response.user_id) {
        setUserInfo(response);
        onConnectionChange(true, response);
      } else {
        onConnectionChange(false);
      }
    } catch (error) {
      console.error('Connection check failed:', error);
      onConnectionChange(false);
    }
  };

  const handleConnectClick = async () => {
    if (!credentialsSet) {
      toast({
        title: "Credentials Required",
        description: "Please set up your API credentials first",
        variant: "destructive",
      });
      setShowCredentialsSetup(true);
      return;
    }

    setLoading(true);
    try {
      console.log('Initiating connection...');
      const response = await tradingApi.login();
      console.log('Login response:', response);
      
      if (response.status === 'requires_login' && response.data?.login_url) {
        setLoginUrl(response.data.login_url);
        setShowConnectionModal(true);
        setLoading(false); // Reset loading immediately when showing modal
        toast({
          title: "Authentication Required",
          description: "Please complete Zerodha login in the modal",
        });
      } else if (response.status === 'success' && response.data) {
        setUserInfo(response.data);
        onConnectionChange(true, response.data);
        toast({
          title: "Already Connected",
          description: "You are already connected to Zerodha",
        });
      } else if (response.status === 'error') {
        toast({
          title: "Connection Error",
          description: response.message || "Failed to connect to broker",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Unexpected Response",
          description: response.message || "Unexpected response from server",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Connection failed:', error);
      
      // Check if it's a network error
      if (error.message?.includes('fetch') || error.name === 'TypeError') {
        toast({
          title: "Backend Connection Error", 
          description: "Cannot connect to trading backend. Please check if the backend server is running.",
          variant: "destructive",
        });
        setShowBackendError(true);
      } else {
        toast({
          title: "Connection Error", 
          description: "Failed to connect to trading backend. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOpenLogin = () => {
    if (loginUrl) {
      window.open(loginUrl, '_blank');
      toast({
        title: "Login Window Opened",
        description: "Complete login and copy the request token from the URL",
      });
    }
  };

  const handleTokenConnect = async () => {
    if (!requestToken.trim()) {
      toast({
        title: "Token Required",
        description: "Please enter the request token from the URL",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      console.log('Attempting login with token:', requestToken);
      const response = await tradingApi.login(requestToken);
      console.log('Token login response:', response);
      
      if (response.status === 'success' && response.data?.user_id) {
        setUserInfo(response.data);
        onConnectionChange(true, response.data);
        setRequestToken("");
        setLoginUrl("");
        setShowConnectionModal(false);
        
        toast({
          title: "Connected Successfully! 🎉",
          description: `Welcome ${response.data.user_name || response.data.user_id}`,
        });
      } else if (response.status === 'error') {
        console.error('Token login failed:', response);
        
        // Provide specific error messages based on the error
        let errorMessage = response.message || "Authentication failed";
        if (errorMessage.includes("api_key") || errorMessage.includes("access_token")) {
          errorMessage = "Invalid or expired token. Please get a new token from Zerodha login.";
        } else if (errorMessage.includes("request_token")) {
          errorMessage = "Invalid request token format. Please copy the exact token from the URL.";
        }
        
        toast({
          title: "Authentication Failed",
          description: errorMessage,
          variant: "destructive",
        });
        
        // Clear the token so user can try again
        setRequestToken("");
      } else {
        console.error('Unexpected response:', response);
        toast({
          title: "Unexpected Response",
          description: response.message || "Unexpected response from server. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('Token connection failed:', error);
      
      // Provide more specific error handling
      let errorMessage = "Failed to authenticate. Please try again.";
      if (error.message?.includes('fetch') || error.name === 'TypeError') {
        errorMessage = "Network error. Please check your connection and try again.";
      } else if (error.message?.includes('timeout')) {
        errorMessage = "Connection timeout. Please try again.";
      }
      
      toast({
        title: "Connection Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setShowConnectionModal(false);
    setRequestToken("");
    setLoginUrl("");
  };

  const handleCredentialsSubmit = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast({
        title: "Missing Credentials",
        description: "Please enter both API key and secret",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await tradingApi.setCredentials(apiKey, apiSecret);
      
      if (response.status === "success") {
        toast({
          title: "Credentials Set",
          description: "API credentials configured successfully",
        });
        setCredentialsSet(true);
        setShowCredentialsSetup(false);
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to set credentials",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to save credentials. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestOrder = async () => {
    setTestOrderLoading(true);
    try {
      const response = await tradingApi.placeTestOrder('SBIN');
      
      if (response.status === 'success') {
        toast({
          title: "✅ Test Order Success!",
          description: response.data?.message || "Test order placed successfully on Zerodha",
        });
      } else {
        const errorMsg = response.message || "Failed to place test order";
        const isAuthError = errorMsg.includes('Not authenticated') || errorMsg.includes('login');
        const isCredentialsError = errorMsg.includes('credentials not found');
        
        toast({
          title: "❌ Test Order Failed",
          description: isAuthError ? "Please login to Zerodha first" : 
                      isCredentialsError ? "API credentials not set up" : 
                      errorMsg,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Test order error:', error);
      toast({
        title: "❌ Test Order Error",
        description: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setTestOrderLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            {isConnected ? (
              <>
                <Wifi className="h-5 w-5 text-success" />
                <span>Broker Connection</span>
              </>
            ) : (
              <>
                <WifiOff className="h-5 w-5 text-destructive" />
                <span>Connect to Broker</span>
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <StatusBadge variant="success">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connected
                </StatusBadge>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={checkConnection}>
                    Refresh
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      onConnectionChange(false);
                      setUserInfo(null);
                      setCredentialsSet(false);
                      toast({
                        title: "Connection Reset",
                        description: "You can now setup new credentials for today's session",
                      });
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
              
              {userInfo && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      <span className="text-muted-foreground">User ID:</span>
                      <span className="font-medium ml-1">{userInfo.user_id}</span>
                    </span>
                  </div>
                  {userInfo.user_name && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Name:</span>
                      <span className="font-medium ml-1">{userInfo.user_name}</span>
                    </div>
                  )}
                </div>
              )}

              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Ready for live trading. All API calls will be executed on your connected account.
                </AlertDescription>
              </Alert>

              {/* Test Order Button */}
              <div className="pt-2 border-t border-border">
                <Button
                  onClick={handleTestOrder}
                  disabled={testOrderLoading}
                  variant="outline"
                  className="w-full"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  {testOrderLoading ? "Placing Test Order..." : "🧪 Test Order Execution"}
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Places a minimal test order (1 share SBIN) to verify API execution
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {!credentialsSet ? (
                <div className="space-y-4">
                  <Button
                    onClick={() => setShowCredentialsSetup(true)}
                    disabled={loading}
                    className="w-full"
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Setup API Credentials
                  </Button>
                  
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      First, set up your Zerodha API credentials to enable trading. You'll need API Key and Secret from Zerodha Console.
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                <div className="space-y-4">
                  <Button
                    onClick={handleConnectClick}
                    disabled={loading}
                    className="w-full"
                  >
                    <LogIn className="h-4 w-4 mr-2" />
                    {loading ? "Connecting..." : "Connect to Zerodha"}
                  </Button>

                  <Button
                    onClick={() => setShowCredentialsSetup(true)}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Update Credentials
                  </Button>

                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      API credentials configured. Click "Connect to Zerodha" to authenticate and start trading.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connection Modal */}
      <Dialog open={showConnectionModal} onOpenChange={setShowConnectionModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Steps to connect:</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-accent/50 p-4 rounded-lg">
              <h4 className="font-medium mb-2">🔗 Connect to Zerodha:</h4>
              <ol className="space-y-2 text-sm">
                <li>1. Click "Open Zerodha Login" below</li>
                <li>2. Login with your Zerodha credentials and complete 2FA</li>
                <li>3. After login, you'll be redirected to a URL containing "request_token="</li>
                <li>4. Copy ONLY the token value (after request_token=) and paste below</li>
                <li>5. Click "🔗 Complete Connection"</li>
              </ol>
            </div>

            <Button
              onClick={handleOpenLogin}
              className="w-full"
              variant="default"
              size="lg"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Zerodha Login
            </Button>

            <div className="space-y-2">
              <Label htmlFor="request_token">Request Token from URL:</Label>
              <Input
                id="request_token"
                placeholder="Paste the request_token value here"
                value={requestToken}
                onChange={(e) => setRequestToken(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Example: If URL is "...request_token=abc123&...", paste only "abc123"
              </p>
            </div>

            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={handleCancel}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleTokenConnect}
                disabled={loading || !requestToken.trim()}
                className="flex-1"
                size="lg"
              >
                {loading ? "Connecting..." : "🔗 Complete Connection"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credentials Setup Modal */}
      <Dialog open={showCredentialsSetup} onOpenChange={setShowCredentialsSetup}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Key className="h-5 w-5" />
              <span>Zerodha API Setup</span>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Alert>
              <ExternalLink className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p>Get your API credentials from Zerodha Console:</p>
                  <a 
                    href="https://kite.trade" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium"
                  >
                    https://kite.trade
                  </a>
                  <p className="text-xs text-muted-foreground">
                    Create an app to get your API key and secret
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="api_key">API Key</Label>
                <Input
                  id="api_key"
                  type="text"
                  placeholder="Enter your Zerodha API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="api_secret">API Secret</Label>
                <div className="relative">
                  <Input
                    id="api_secret"
                    type={showSecret ? "text" : "password"}
                    placeholder="Enter your Zerodha API secret"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    className="font-mono pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={() => setShowCredentialsSetup(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCredentialsSubmit}
                disabled={loading || !apiKey.trim() || !apiSecret.trim()}
                className="flex-1"
              >
                {loading ? "Setting up..." : "Save Credentials"}
              </Button>
            </div>

            <Alert>
              <AlertDescription>
                <div className="space-y-1">
                  <p className="font-medium">Security Notes:</p>
                  <p className="text-xs text-muted-foreground">
                    • Credentials are stored securely in the backend<br/>
                    • Never share your API credentials with anyone<br/>
                    • You can revoke access anytime from Zerodha Console
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        </DialogContent>
      </Dialog>

      {/* Backend Error Modal */}
      <Dialog open={showBackendError} onOpenChange={setShowBackendError}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span>Backend Server Required</span>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Alert>
              <Server className="h-4 w-4" />
              <AlertDescription>
                The Python backend server is not running. This is required to connect to Zerodha APIs.
              </AlertDescription>
            </Alert>

            <div className="bg-muted p-4 rounded-lg space-y-3">
              <p className="font-medium text-sm">To start the backend server:</p>
              
              <div className="space-y-2">
                <div className="bg-background p-3 rounded border font-mono text-sm">
                  <div className="text-muted-foreground"># Install dependencies:</div>
                  <div className="text-foreground">pip install -r requirements.txt</div>
                </div>
                
                <div className="bg-background p-3 rounded border font-mono text-sm">
                  <div className="text-muted-foreground"># Start the server:</div>
                  <div className="text-foreground">python main.py</div>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground">
                The server should run on <code className="bg-background px-1 rounded">http://127.0.0.1:8000</code>
              </p>
            </div>

            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={() => setShowBackendError(false)}
                className="flex-1"
              >
                Close
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const response = await tradingApi.testConnection();
                    if (response.status === 'connected' || response.status === 'success') {
                      setShowBackendError(false);
                      toast({
                        title: "Success",
                        description: "Backend server is now running!",
                      });
                    } else {
                      toast({
                        title: "Still Not Connected",
                        description: "Server is not responding correctly",
                        variant: "destructive",
                      });
                    }
                  } catch {
                    toast({
                      title: "Still Not Running",
                      description: "Backend server is still not accessible",
                      variant: "destructive",
                    });
                  }
                }}
                className="flex-1"
              >
                <Server className="h-4 w-4 mr-2" />
                Test Connection
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}