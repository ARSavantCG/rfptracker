/**
 * Script to populate default PDF templates extracted from existing PDF generation code
 */

import { Pool } from '@neondatabase/serverless';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const defaultTemplates = [
  {
    template_key: 'architect_header',
    template_name: 'Architect RFP Header',
    template_type: 'architect',
    section: 'header',
    content: 'REQUEST FOR PROPOSAL',
    description: 'Main header text for architect RFP documents'
  },
  {
    template_key: 'architect_subtitle',
    template_name: 'Architect RFP Subtitle',
    template_type: 'architect',
    section: 'subtitle',
    content: 'ARCHITECT SERVICES',
    description: 'Subtitle text for architect RFP documents'
  },
  {
    template_key: 'contractor_header',
    template_name: 'Contractor RFP Header',
    template_type: 'contractor',
    section: 'header',
    content: 'REQUEST FOR PROPOSAL',
    description: 'Main header text for contractor RFP documents'
  },
  {
    template_key: 'contractor_subtitle',
    template_name: 'Contractor RFP Subtitle',
    template_type: 'contractor',
    section: 'subtitle',
    content: 'GENERAL CONTRACTOR SERVICES',
    description: 'Subtitle text for contractor RFP documents'
  },
  {
    template_key: 'broker_architect_header',
    template_name: 'Broker-Architect RFP Header',
    template_type: 'broker-architect',
    section: 'header',
    content: 'REQUEST FOR PROPOSAL',
    description: 'Main header text for broker-architect RFP documents'
  },
  {
    template_key: 'broker_architect_subtitle',
    template_name: 'Broker-Architect RFP Subtitle',
    template_type: 'broker-architect',
    section: 'subtitle',
    content: 'BROKER / ARCHITECT SERVICES',
    description: 'Subtitle text for broker-architect RFP documents'
  },
  {
    template_key: 'broker_contractor_header',
    template_name: 'Broker-Contractor RFP Header',
    template_type: 'broker-contractor',
    section: 'header',
    content: 'REQUEST FOR PROPOSAL',
    description: 'Main header text for broker-contractor RFP documents'
  },
  {
    template_key: 'broker_contractor_subtitle',
    template_name: 'Broker-Contractor RFP Subtitle',
    template_type: 'broker-contractor',
    section: 'subtitle',
    content: 'BROKER / GENERAL CONTRACTOR SERVICES',
    description: 'Subtitle text for broker-contractor RFP documents'
  },
  {
    template_key: 'common_introduction',
    template_name: 'Common Introduction Text',
    template_type: 'common',
    section: 'introduction',
    content: 'Bridge Industrial is seeking qualified professionals to provide services for the following project. Please review the project details and requirements below.',
    description: 'Standard introduction text used across all RFP types'
  },
  {
    template_key: 'submission_requirements',
    template_name: 'Submission Requirements',
    template_type: 'common',
    section: 'submission_requirements',
    content: `Please provide the following with your proposal:
• Detailed project timeline and milestones
• Comprehensive cost breakdown
• Relevant project experience and references
• Proof of insurance and licensing
• Any questions or clarifications needed`,
    description: 'Standard submission requirements for all RFP types'
  },
  {
    template_key: 'contact_footer',
    template_name: 'Contact Footer',
    template_type: 'common',
    section: 'footer',
    content: 'For questions regarding this RFP, please contact the development team member listed above.',
    description: 'Standard footer contact information'
  }
];

async function populateTemplates() {
  try {
    console.log('Populating default PDF templates...');
    
    for (const template of defaultTemplates) {
      const query = `
        INSERT INTO pdf_templates (template_key, template_name, template_type, section, content, description, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (template_key) DO UPDATE SET
          template_name = EXCLUDED.template_name,
          content = EXCLUDED.content,
          description = EXCLUDED.description,
          updated_at = NOW()
      `;
      
      await pool.query(query, [
        template.template_key,
        template.template_name,
        template.template_type,
        template.section,
        template.content,
        template.description
      ]);
      
      console.log(`✓ Created/updated template: ${template.template_name}`);
    }
    
    console.log('✓ All default PDF templates have been populated successfully!');
  } catch (error) {
    console.error('Error populating templates:', error);
  } finally {
    await pool.end();
  }
}

populateTemplates();