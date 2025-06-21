import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Mail, Phone, Building2, Plus, Search } from "lucide-react";
import { useState } from "react";
import Navigation from "@/components/navigation";
import { ContactFormModal } from "@/components/contact-form-modal";
import type { Contact } from "@shared/schema";

export default function Contacts() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");

  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const filteredContacts = contacts?.filter(contact => {
    const matchesSearch = contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.type.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = selectedType === "all" || contact.type === selectedType;
    
    return matchesSearch && matchesType;
  }) || [];

  const getContactTypeColor = (type: string) => {
    switch (type) {
      case 'contractor': return 'bg-blue-100 text-blue-800';
      case 'architect': return 'bg-green-100 text-green-800';
      case 'owner': return 'bg-purple-100 text-purple-800';
      case 'other': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getContactIcon = (type: string) => {
    switch (type) {
      case 'contractor': return '🔨';
      case 'architect': return '📐';
      case 'owner': return '🏢';
      case 'other': return '👤';
      default: return '👤';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Users className="h-8 w-8 text-blue-600" />
              Contacts
            </h1>
            <p className="text-gray-600 mt-2">
              Manage your contractors, architects, and property owners
            </p>
          </div>
          <ContactFormModal />
        </div>

        {/* Search Bar */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search contacts by name, email, company, or type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Filter Cards */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Filter by Contact Type</h3>
            {selectedType !== 'all' && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setSelectedType('all')}
                className="text-gray-600 hover:text-gray-900"
              >
                Show All Contacts
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
          <Card 
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedType === 'architect' ? 'ring-2 ring-green-500 bg-green-50' : ''
            }`}
            onClick={() => setSelectedType(selectedType === 'architect' ? 'all' : 'architect')}
          >
            <CardContent className="p-3">
              <div className="flex items-center">
                <div className="p-1.5 bg-green-100 rounded-md">
                  <span className="text-sm">📐</span>
                </div>
                <div className="ml-3">
                  <p className="text-lg font-bold">
                    {contacts?.filter(c => c.type === 'architect').length || 0}
                  </p>
                  <p className="text-gray-600 text-xs">Architects</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card 
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedType === 'contractor' ? 'ring-2 ring-blue-500 bg-blue-50' : ''
            }`}
            onClick={() => setSelectedType(selectedType === 'contractor' ? 'all' : 'contractor')}
          >
            <CardContent className="p-3">
              <div className="flex items-center">
                <div className="p-1.5 bg-blue-100 rounded-md">
                  <span className="text-sm">🔨</span>
                </div>
                <div className="ml-3">
                  <p className="text-lg font-bold">
                    {contacts?.filter(c => c.type === 'contractor').length || 0}
                  </p>
                  <p className="text-gray-600 text-xs">Contractors</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card 
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedType === 'owner' ? 'ring-2 ring-purple-500 bg-purple-50' : ''
            }`}
            onClick={() => setSelectedType(selectedType === 'owner' ? 'all' : 'owner')}
          >
            <CardContent className="p-3">
              <div className="flex items-center">
                <div className="p-1.5 bg-purple-100 rounded-md">
                  <Building2 className="h-4 w-4 text-purple-600" />
                </div>
                <div className="ml-3">
                  <p className="text-lg font-bold">
                    {contacts?.filter(c => c.type === 'owner').length || 0}
                  </p>
                  <p className="text-gray-600 text-xs">Property Owners</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card 
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedType === 'other' ? 'ring-2 ring-orange-500 bg-orange-50' : ''
            }`}
            onClick={() => setSelectedType(selectedType === 'other' ? 'all' : 'other')}
          >
            <CardContent className="p-3">
              <div className="flex items-center">
                <div className="p-1.5 bg-orange-100 rounded-md">
                  <span className="text-sm">👤</span>
                </div>
                <div className="ml-3">
                  <p className="text-lg font-bold">
                    {contacts?.filter(c => c.type === 'other').length || 0}
                  </p>
                  <p className="text-gray-600 text-xs">Other</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Contacts Grid */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading contacts...</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <Users className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {searchTerm ? 'No contacts found' : 'No contacts yet'}
                </h3>
                <p className="text-gray-600 mb-6">
                  {searchTerm 
                    ? 'Try adjusting your search terms'
                    : 'Get started by adding your first contact'
                  }
                </p>
                {!searchTerm && (
                  <ContactFormModal />
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredContacts.map((contact) => (
              <Card key={contact.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="text-xl">
                        {getContactIcon(contact.type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base truncate">{contact.name}</CardTitle>
                        <Badge className={`mt-1 text-xs ${getContactTypeColor(contact.type)}`}>
                          {contact.type.charAt(0).toUpperCase() + contact.type.slice(1)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {contact.company && (
                      <div className="flex items-center text-sm text-gray-600">
                        <Building2 className="h-4 w-4 mr-2" />
                        {contact.company}
                      </div>
                    )}
                    
                    <div className="flex items-center text-sm text-gray-600">
                      <Mail className="h-4 w-4 mr-2" />
                      <a 
                        href={`mailto:${contact.email}`}
                        className="hover:text-blue-600 truncate"
                      >
                        {contact.email}
                      </a>
                    </div>
                    
                    {contact.phone && (
                      <div className="flex items-center text-sm text-gray-600">
                        <Phone className="h-4 w-4 mr-2" />
                        <a 
                          href={`tel:${contact.phone}`}
                          className="hover:text-blue-600"
                        >
                          {contact.phone}
                        </a>
                      </div>
                    )}
                    
                    {contact.notes && (
                      <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                        {contact.notes}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex space-x-2 mt-4">
                    <ContactFormModal 
                      contact={contact}
                      trigger={
                        <Button variant="outline" size="sm" className="flex-1">
                          Edit
                        </Button>
                      }
                    />
                    <Button variant="outline" size="sm">
                      <Mail className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm">
                      <Phone className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}