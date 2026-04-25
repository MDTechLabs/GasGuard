import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('gas_savings')
@Index(['projectId', 'scanId'])
@Index(['createdAt'])
export class GasSavings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @Column()
  scanId: string;

  @Column()
  fileName: string;

  @Column()
  ruleId: string;

  @Column()
  ruleName: string;

  @Column('int')
  gasSaved: number;

  @Column('int')
  severity: number; // 1=Info, 2=Warning, 3=Error, 4=Critical

  @Column('text', { nullable: true })
  description: string;

  @Column('text', { nullable: true })
  suggestion: string;

  @Column('int')
  lineNumber: number;

  @CreateDateColumn()
  createdAt: Date;
}
