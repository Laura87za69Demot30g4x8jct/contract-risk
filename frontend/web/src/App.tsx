// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ContractAnalysis {
  id: string;
  encryptedContract: string;
  timestamp: number;
  owner: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "analyzed";
  riskReport?: string;
}

const App: React.FC = () => {
  // Wallet state
  const [account, setAccount] = useState("");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  
  // Contract data state
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState<ContractAnalysis[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // UI state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showDetails, setShowDetails] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [riskFilter, setRiskFilter] = useState<"all" | "low" | "medium" | "high">("all");
  
  // Transaction feedback
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  
  // New contract form
  const [newContractData, setNewContractData] = useState({
    contractName: "",
    contractType: "",
    encryptedContent: ""
  });

  // Calculate statistics
  const analyzedCount = contracts.filter(c => c.status === "analyzed").length;
  const pendingCount = contracts.filter(c => c.status === "pending").length;
  const highRiskCount = contracts.filter(c => c.riskLevel === "high").length;
  const mediumRiskCount = contracts.filter(c => c.riskLevel === "medium").length;
  const lowRiskCount = contracts.filter(c => c.riskLevel === "low").length;

  // Filter contracts based on search and filter
  const filteredContracts = contracts.filter(contract => {
    const matchesSearch = contract.id.includes(searchTerm) || 
                          contract.contractName?.includes(searchTerm);
    const matchesRisk = riskFilter === "all" || contract.riskLevel === riskFilter;
    return matchesSearch && matchesRisk;
  });

  // Load contracts on initial render
  useEffect(() => {
    loadContracts().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      // Check contract availability
      try {
        const contract = await getContractReadOnly();
        if (contract) {
          const isAvailable = await contract.isAvailable();
          if (isAvailable) {
            setTransactionStatus({
              visible: true,
              status: "success",
              message: "FHE contract is available!"
            });
            setTimeout(() => setTransactionStatus({visible: false, status: "pending", message: ""}), 2000);
          }
        }
      } catch (e) {
        console.error("Contract availability check failed:", e);
      }

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load contracts from blockchain
  const loadContracts = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Get list of contract keys
      const keysBytes = await contract.getData("contract_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing contract keys:", e);
        }
      }
      
      const list: ContractAnalysis[] = [];
      
      // Load each contract data
      for (const key of keys) {
        try {
          const contractBytes = await contract.getData(`contract_${key}`);
          if (contractBytes.length > 0) {
            try {
              const contractData = JSON.parse(ethers.toUtf8String(contractBytes));
              list.push({
                id: key,
                encryptedContract: contractData.data,
                timestamp: contractData.timestamp,
                owner: contractData.owner,
                riskLevel: contractData.riskLevel || "low",
                status: contractData.status || "pending",
                contractName: contractData.contractName,
                riskReport: contractData.riskReport
              });
            } catch (e) {
              console.error(`Error parsing contract data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading contract ${key}:`, e);
        }
      }
      
      // Sort by timestamp
      list.sort((a, b) => b.timestamp - a.timestamp);
      setContracts(list);
    } catch (e) {
      console.error("Error loading contracts:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Upload new encrypted contract
  const uploadContract = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting contract with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Generate unique ID
      const contractId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Prepare contract data
      const contractData = {
        data: newContractData.encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        contractName: newContractData.contractName,
        contractType: newContractData.contractType,
        status: "pending",
        riskLevel: "low"
      };
      
      // Store encrypted contract on-chain
      await contract.setData(
        `contract_${contractId}`, 
        ethers.toUtf8Bytes(JSON.stringify(contractData))
      );
      
      // Update keys list
      const keysBytes = await contract.getData("contract_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(contractId);
      
      await contract.setData(
        "contract_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Contract uploaded securely!"
      });
      
      // Refresh contract list
      await loadContracts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewContractData({
          contractName: "",
          contractType: "",
          encryptedContent: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  // Analyze contract with FHE
  const analyzeContract = async (contractId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Analyzing contract with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Get contract data
      const contractBytes = await contract.getData(`contract_${contractId}`);
      if (contractBytes.length === 0) {
        throw new Error("Contract not found");
      }
      
      const contractData = JSON.parse(ethers.toUtf8String(contractBytes));
      
      // Simulate FHE analysis (in a real app, this would be done off-chain)
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Generate simulated risk report
      const riskLevels = ["low", "medium", "high"];
      const randomRisk = riskLevels[Math.floor(Math.random() * riskLevels.length)];
      const riskReport = `FHE analysis detected ${Math.floor(Math.random() * 5) + 1} risk clauses in the contract.`;
      
      // Update contract with analysis results
      const updatedContract = {
        ...contractData,
        status: "analyzed",
        riskLevel: randomRisk,
        riskReport: riskReport
      };
      
      // Save updated contract
      await contract.setData(
        `contract_${contractId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedContract))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed!"
      });
      
      // Refresh contract list
      await loadContracts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Check if current user is owner
  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  // Tutorial steps
  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the platform",
      icon: "🔗"
    },
    {
      title: "Upload Contract",
      description: "Securely upload encrypted legal contracts",
      icon: "📄"
    },
    {
      title: "FHE Analysis",
      description: "AI analyzes contract risks without decrypting content",
      icon: "🔍"
    },
    {
      title: "Review Results",
      description: "Receive encrypted risk reports while maintaining confidentiality",
      icon: "📊"
    }
  ];

  // Render risk distribution chart
  const renderRiskChart = () => {
    const total = contracts.length || 1;
    const highPercentage = (highRiskCount / total) * 100;
    const mediumPercentage = (mediumRiskCount / total) * 100;
    const lowPercentage = (lowRiskCount / total) * 100;

    return (
      <div className="risk-chart-container">
        <div className="risk-chart">
          <div 
            className="risk-segment high" 
            style={{ transform: `rotate(${highPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="risk-segment medium" 
            style={{ transform: `rotate(${(highPercentage + mediumPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="risk-segment low" 
            style={{ transform: `rotate(${(highPercentage + mediumPercentage + lowPercentage) * 3.6}deg)` }}
          ></div>
          <div className="risk-center">
            <div className="risk-value">{contracts.length}</div>
            <div className="risk-label">Contracts</div>
          </div>
        </div>
        <div className="risk-legend">
          <div className="legend-item">
            <div className="color-box high"></div>
            <span>High Risk: {highRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box medium"></div>
            <span>Medium Risk: {mediumRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box low"></div>
            <span>Low Risk: {lowRiskCount}</span>
          </div>
        </div>
      </div>
    );
  };

  // Loading state
  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Legal<span>Shield</span>AI</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn tech-button"
          >
            <div className="add-icon"></div>
            Upload Contract
          </button>
          <button 
            className="tech-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "User Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-panels">
          <div className="panel intro-panel">
            <h2>Confidential Contract Risk Analysis</h2>
            <p>Securely analyze legal contracts using Fully Homomorphic Encryption (FHE) without exposing sensitive content.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Confidentiality</span>
            </div>
          </div>
          
          <div className="panel stats-panel">
            <h3>Contract Analytics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{contracts.length}</div>
                <div className="stat-label">Total Contracts</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">Analyzed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
          </div>
          
          <div className="panel chart-panel">
            <h3>Risk Distribution</h3>
            {renderRiskChart()}
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-panel">
            <h2>How It Works</h2>
            <p className="subtitle">Secure contract analysis using FHE technology</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="contracts-section">
          <div className="section-header">
            <h2>Contract Analysis</h2>
            <div className="filters">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search contracts..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="tech-input"
                />
                <div className="search-icon"></div>
              </div>
              <select 
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value as any)}
                className="tech-select"
              >
                <option value="all">All Risks</option>
                <option value="high">High Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="low">Low Risk</option>
              </select>
              <button 
                onClick={loadContracts}
                className="refresh-btn tech-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="contracts-list">
            {filteredContracts.length === 0 ? (
              <div className="no-contracts">
                <div className="no-contracts-icon"></div>
                <p>No contracts found</p>
                <button 
                  className="tech-button primary"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Contract
                </button>
              </div>
            ) : (
              filteredContracts.map(contract => (
                <div 
                  className={`contract-card ${contract.riskLevel}`} 
                  key={contract.id}
                >
                  <div className="contract-header">
                    <div className="contract-id">#{contract.id.substring(0, 6)}</div>
                    <div className="contract-name">{contract.contractName || "Unnamed Contract"}</div>
                    <div className="contract-status">
                      <span className={`status-badge ${contract.status}`}>
                        {contract.status}
                      </span>
                    </div>
                  </div>
                  
                  <div className="contract-details">
                    <div className="detail-item">
                      <span className="detail-label">Owner:</span>
                      <span className="detail-value">{contract.owner.substring(0, 6)}...{contract.owner.substring(38)}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Uploaded:</span>
                      <span className="detail-value">
                        {new Date(contract.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Risk Level:</span>
                      <span className={`risk-value ${contract.riskLevel}`}>
                        {contract.riskLevel}
                      </span>
                    </div>
                  </div>
                  
                  <div className="contract-actions">
                    {contract.status === "pending" && isOwner(contract.owner) && (
                      <button 
                        className="action-btn tech-button"
                        onClick={() => analyzeContract(contract.id)}
                      >
                        Analyze with FHE
                      </button>
                    )}
                    
                    {contract.status === "analyzed" && (
                      <button 
                        className="action-btn tech-button"
                        onClick={() => setShowDetails(contract.id === showDetails ? null : contract.id)}
                      >
                        {showDetails === contract.id ? "Hide Details" : "View Report"}
                      </button>
                    )}
                  </div>
                  
                  {showDetails === contract.id && contract.riskReport && (
                    <div className="risk-report">
                      <h4>Risk Analysis Report</h4>
                      <p>{contract.riskReport}</p>
                      <div className="fhe-note">
                        <div className="lock-icon"></div>
                        Analysis performed on encrypted data using FHE
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadContract} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          contractData={newContractData}
          setContractData={setNewContractData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>LegalShieldAI</span>
            </div>
            <p>Confidential contract analysis using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Support</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} LegalShieldAI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  contractData: any;
  setContractData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  contractData,
  setContractData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setContractData({
      ...contractData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!contractData.contractName || !contractData.encryptedContent) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal tech-card">
        <div className="modal-header">
          <h2>Upload Encrypted Contract</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your contract will remain encrypted using FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Contract Name *</label>
              <input 
                type="text"
                name="contractName"
                value={contractData.contractName} 
                onChange={handleChange}
                placeholder="e.g., NDA Agreement" 
                className="tech-input"
              />
            </div>
            
            <div className="form-group">
              <label>Contract Type</label>
              <select 
                name="contractType"
                value={contractData.contractType} 
                onChange={handleChange}
                className="tech-select"
              >
                <option value="">Select type</option>
                <option value="Employment">Employment Agreement</option>
                <option value="NDA">Non-Disclosure Agreement</option>
                <option value="Partnership">Partnership Agreement</option>
                <option value="Service">Service Contract</option>
                <option value="Licensing">Licensing Agreement</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Encrypted Content *</label>
              <textarea 
                name="encryptedContent"
                value={contractData.encryptedContent} 
                onChange={handleChange}
                placeholder="Paste encrypted contract content..." 
                className="tech-textarea"
                rows={6}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            Content remains encrypted during FHE analysis process
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn tech-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn tech-button primary"
          >
            {uploading ? "Uploading with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;