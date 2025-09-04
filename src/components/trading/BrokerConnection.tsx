import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wifi, WifiOff, LogIn, User, AlertCircle, CheckCircle } from "lucide-react";
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
        // Handle direct response format from main.py
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

  const handleConnect = async () => {
    setLoading(true);
    try {
      // First call to get login URL
      const response = await tradingApi.login();
      
      if (response.status === 'requires_login' && response.login_url) {
        setLoginUrl(response.login_url);
        // Automatically open the login URL
        window.open(response.login_url, '_blank');
        toast({
          title: "Login Window Opened",
          description: "Complete login and copy the request token from the redirect URL",
        });
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to get login URL",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to connect to trading platform",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTokenSubmit = async () => {
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
        
        // Save token with expiry (6:30 AM next day)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(6, 30, 0, 0);
        localStorage.setItem('zerodha_token_expiry', tomorrow.getTime().toString());
        
        toast({
          title: "Connected Successfully",
          description: `Welcome ${response.user_id}. Token saved until 6:30 AM tomorrow.`,
        });
      } else {
        toast({
          title: "Login Failed",
          description: response.message || "Invalid token",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Failed to connect with token",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openLoginPage = () => {
    if (loginUrl) {
      window.open(loginUrl, '_blank');
    }
  };

  return (
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
            {!loginUrl ? (
              <Button
                onClick={handleConnect}
                disabled={loading}
                className="w-full"
              >
                <LogIn className="h-4 w-4 mr-2" />
                {loading ? "Connecting..." : "Connect to Zerodha"}
              </Button>
            ) : (
              <div className="space-y-3">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p>1. Click "Open Zerodha Login" to visit the login page</p>
                      <p>2. Complete login with your Zerodha credentials</p>
                      <p>3. After login, you'll be redirected to a URL containing the request token</p>
                      <p>4. Copy the token from the URL (after ?request_token=) and paste it below</p>
                      <p className="text-xs text-muted-foreground">Note: Tokens expire daily and need to be regenerated</p>
                    </div>
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={openLoginPage}
                  variant="outline"
                  className="w-full"
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Open Zerodha Login
                </Button>

                <div className="space-y-2">
                  <Label htmlFor="request_token">Request Token from Redirect URL</Label>
                  <Input
                    id="request_token"
                    placeholder="Paste request token here (e.g., xyz123abc456)"
                    value={requestToken}
                    onChange={(e) => setRequestToken(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    The token will be in the redirect URL: https://kite.zerodha.com/connect/login?request_token=<strong>YOUR_TOKEN</strong>
                  </p>
                </div>

                <Button
                  onClick={handleTokenSubmit}
                  disabled={loading || !requestToken.trim()}
                  className="w-full"
                >
                  {loading ? "Connecting..." : "Complete Connection"}
                </Button>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  <p>Connect to your Zerodha account to enable live trading.</p>
                  <p className="text-xs text-muted-foreground">
                    • Your credentials are secure and handled directly by Zerodha's API<br/>
                    • Access tokens expire daily and need to be regenerated<br/>
                    • This follows Zerodha's security requirements for API access
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
    </Card>
  );
}