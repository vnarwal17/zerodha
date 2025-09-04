import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wifi, WifiOff, LogIn, User, AlertCircle, CheckCircle, Link as LinkIcon, Key, Eye, EyeOff, ExternalLink, Settings, AlertTriangle, Server } from "lucide-react";
import { useState, useEffect } from "react";
import { tradingApi } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface BrokerConnectionProps {
  isConnected: boolean;
  onConnectionChange: (connected: boolean, userData?: any) => void;
}

export function BrokerConnection({ isConnected, onConnectionChange }: BrokerConnectionProps) {
  const [loading, setLoading] = useState(false);
  const [requestToken, setRequestToken] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [userInfo, setUserInfo] = useState<any>(null);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showCredentialsSetup, setShowCredentialsSetup] = useState(false);
  const [showBackendError, setShowBackendError] = useState(false);
  
  // Credentials state
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [credentialsSet, setCredentialsSet] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    checkConnection();
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
    setLoading(true);
    try {
      const response = await tradingApi.login();
      
      if (response.status === 'requires_login' && response.login_url) {
        setLoginUrl(response.login_url);
        setShowConnectionModal(true);
      } else if (response.status === 'success') {
        // Already connected
        setUserInfo(response);
        onConnectionChange(true, response);
        toast({
          title: "Already Connected",
          description: "You are already connected to Zerodha",
        });
      } else {
        toast({
          title: "Connection Error",
          description: response.message || "Failed to get login URL",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Connection failed:', error);
      toast({
        title: "Connection Error", 
        description: "Failed to connect to trading backend. Please check your internet connection and try again.",
        variant: "destructive",
      });
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
        description: "Please enter the request token",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await tradingApi.login(requestToken);
      
      if (response.status === 'success' && response.user_id) {
        setUserInfo(response);
        onConnectionChange(true, response);
        setRequestToken("");
        setLoginUrl("");
        setShowConnectionModal(false);
        
        toast({
          title: "Connected Successfully",
          description: `Welcome ${response.user_id}`,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: response.message || "Invalid token",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Token connection failed:', error);
      toast({
        title: "Connection Error",
        description: "Failed to authenticate with token. Please check your token and try again.",
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
                <Button variant="outline" size="sm" onClick={checkConnection}>
                  Refresh
                </Button>
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
              <ol className="space-y-2 text-sm">
                <li>1. Click "Open Zerodha Login" below</li>
                <li>2. Login with your credentials and complete 2FA</li>
                <li>3. Copy the 'request_token' from the redirected URL</li>
                <li>4. Paste it below and click Connect</li>
              </ol>
            </div>

            <Button
              onClick={handleOpenLogin}
              className="w-full"
              variant="default"
            >
              <LinkIcon className="h-4 w-4 mr-2" />
              Open Zerodha Login
            </Button>

            <div className="space-y-2">
              <Input
                placeholder="Paste request_token here (from URL after login)"
                value={requestToken}
                onChange={(e) => setRequestToken(e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex space-x-3">
              <Button
                variant="destructive"
                onClick={handleCancel}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleTokenConnect}
                disabled={loading || !requestToken.trim()}
                className="flex-1"
              >
                {loading ? "Connecting..." : "🔗 Connect"}
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