import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Wifi, WifiOff, LogIn, User, AlertCircle, CheckCircle, Link as LinkIcon } from "lucide-react";
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
      toast({
        title: "Connection Error",
        description: "Failed to connect to trading platform. Make sure the backend is running.",
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
      toast({
        title: "Connection Error",
        description: "Failed to connect with token",
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
              <Button
                onClick={handleConnectClick}
                disabled={loading}
                className="w-full"
              >
                <LogIn className="h-4 w-4 mr-2" />
                {loading ? "Connecting..." : "Connect to Zerodha"}
              </Button>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Connect to your Zerodha account to enable live trading. Your credentials are secure and handled directly by Zerodha's API.
                </AlertDescription>
              </Alert>
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
    </>
  );
}